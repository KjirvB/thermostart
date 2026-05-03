import calendar
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

import requests
from flask import Blueprint, Response, jsonify, make_response, request
from flask_socketio import emit

from thermostart import db
from thermostart.config import Config
from thermostart.models import Device, DeviceMessage, Location, ParsedMessage

from .utils import (
    Source,
    decrypt_request,
    encrypt_response,
    firmware_upgrade_needed,
    get_firmware,
    interpret_slave_config,
    interpret_status,
    parse_f8_8,
    parse_message,
)

_LOGGER = logging.getLogger(__name__)
ts = Blueprint("ts", __name__)
TOMORROW_APIKEY = os.getenv("TOMORROW_APIKEY", "")


def _arg_is_true(name):
    return request.args.get(name, "").lower() in ("1", "true")


def _tenths_to_celsius(value):
    return value / 10 if value is not None else None


def _source_name(source):
    try:
        return Source(source).name
    except ValueError:
        return str(source)


def _opentherm_payload(device, include_raw):
    status = interpret_status(device.ot0)
    master_status = status["master_status"]
    slave_status = status["slave_status"]
    slave_config = interpret_slave_config(device.ot3)["slave_config"]
    ot = {
        "enabled": device.oo,
        "control_type": "on/off" if slave_config["Control type"] else "modulating",
        "fault_indication": bool(slave_status["Fault indication"]),
        "ch_enabled": bool(master_status["CH enable"]),
        "ch_active": bool(slave_status["CH mode"]),
        "dhw_present": bool(slave_config["DHW present"]),
        "dhw_active": bool(slave_status["DHW mode"]),
        "flame_on": bool(slave_status["Flame status"]),
        "dhw_setpoint_temperature": round(parse_f8_8(device.ot56), 1),
        "boiler_water_temperature": round(parse_f8_8(device.ot25), 1),
        "return_water_temperature": round(parse_f8_8(device.ot28), 1),
        "boiler_pressure": round(parse_f8_8(device.ot18), 2),
    }
    if include_raw:
        ot["raw"] = {
            "ot0": device.ot0,
            "ot1": device.ot1,
            "ot3": device.ot3,
            "ot17": device.ot17,
            "ot18": device.ot18,
            "ot19": device.ot19,
            "ot25": device.ot25,
            "ot26": device.ot26,
            "ot27": device.ot27,
            "ot28": device.ot28,
            "ot34": device.ot34,
            "ot56": device.ot56,
            "ot125": device.ot125,
        }
    return ot


def _boiler_realtime_patch(device):
    """Broadcast shape used by the v2 UI to keep Boiler values live."""
    otparams = [
        "ot0",
        "ot1",
        "ot3",
        "ot17",
        "ot18",
        "ot19",
        "ot25",
        "ot26",
        "ot27",
        "ot28",
        "ot34",
        "ot56",
        "ot125",
    ]
    patch = {"oo": device.oo}
    for param in otparams:
        patch[param] = getattr(device, param)
    patch.update(
        parsed_ot0=interpret_status(device.ot0) if device.ot0 is not None else None,
        parsed_ot1=parse_f8_8(device.ot1) if device.ot1 is not None else None,
        parsed_ot17=parse_f8_8(device.ot17) if device.ot17 is not None else None,
        parsed_ot18=parse_f8_8(device.ot18) if device.ot18 is not None else None,
        parsed_ot19=parse_f8_8(device.ot19) if device.ot19 is not None else None,
        parsed_ot25=parse_f8_8(device.ot25) if device.ot25 is not None else None,
        parsed_ot26=parse_f8_8(device.ot26) if device.ot26 is not None else None,
        parsed_ot27=parse_f8_8(device.ot27) if device.ot27 is not None else None,
        parsed_ot28=parse_f8_8(device.ot28) if device.ot28 is not None else None,
        parsed_ot34=parse_f8_8(device.ot34) if device.ot34 is not None else None,
        parsed_ot56=parse_f8_8(device.ot56) if device.ot56 is not None else None,
        parsed_ot125=parse_f8_8(device.ot125) if device.ot125 is not None else None,
    )
    return patch


def _dhw_mode_for_preset(device, preset):
    dhw_programs = device.dhw_programs or {}
    if not isinstance(dhw_programs, dict):
        return 0

    value = dhw_programs.get(preset, 0)
    if isinstance(value, str):
        value = value.strip().lower()
        if value in ("true", "yes", "on"):
            return 1
        if value in ("false", "no", "off", ""):
            return 0

    try:
        return 1 if int(value) else 0
    except (TypeError, ValueError):
        return 0


def _calendar_payload(device):
    std_week = ""
    for block in device.standard_week:
        preset = block["temperature"]
        std_week += "s{:01d}{:02d}{:02d}{:03d}{:01d}".format(
            block["start"][0] + 1,
            block["start"][1],
            block["start"][2],
            device.predefined_temperatures[preset],
            _dhw_mode_for_preset(device, preset),
        )

    exc_week = ""
    for block in device.exceptions:
        preset = block["temperature"]
        start = datetime(
            block["start"][0],
            block["start"][1] + 1,
            block["start"][2],
            0,
            0,
            tzinfo=timezone(timedelta(seconds=-time.timezone)),
        )
        end = datetime(
            block["end"][0],
            block["end"][1] + 1,
            block["end"][2],
            0,
            0,
            tzinfo=timezone(timedelta(seconds=-time.timezone)),
        )
        start = start + timedelta(hours=block["start"][3], minutes=block["start"][4])
        end = end + timedelta(hours=block["end"][3], minutes=block["end"][4])
        start = int(start.astimezone(timezone.utc).timestamp())
        end = int(end.astimezone(timezone.utc).timestamp())
        exc_week += "x{:08X}{:08X}{:03d}{:01d}X".format(
            start,
            end,
            device.predefined_temperatures[preset],
            _dhw_mode_for_preset(device, preset),
        )

    return std_week + exc_week


@ts.route("/fw")
@ts.route("/fw/hcu")
def firmware_update():
    arg = str(next(iter(request.args))).split("_")
    hardware_id = arg[1]
    _LOGGER.info(
        "Got firmare request from %s with hardware id %s and request %s..",
        request.remote_addr,
        arg[1],
        arg[2][:20],
    )
    device = Device.query.get(hardware_id)
    if device is None:
        _LOGGER.warn(
            "Device with IP %s and hardware id %s is trying to communicate, but has not been registered.",
            request.remote_addr,
            arg[1],
        )
        return Response(response="no activated device", status=400)
    try:
        tsreq = parse_qs(decrypt_request(arg[2], device.password))
    except Exception:
        _LOGGER.warn(
            "Request from device with IP %s and hardware id %s cannot be decoded.",
            request.remote_addr,
            arg[1],
        )
        return Response(response="incorrect request", status=400)
    if tsreq["p"][0] != device.password:
        return Response(response="password mismatch", status=400)
    hw = int(tsreq["hw"][0])
    _LOGGER.info(
        "Sending patched firmware to %s with hardware id %s, revision %d",
        request.remote_addr,
        arg[1],
        hw,
    )
    data = get_firmware(
        hw, {"hostname": device.host, "port": device.port, "replace_yourowl.com": True}
    )
    data = encrypt_response(data, device.password)
    response = make_response(data)
    response.headers.set("Content-Type", "text/plain")
    return response


@ts.route("/api")
def api():
    arg = str(next(iter(request.args))).split("_")
    hardware_id = arg[1]
    _LOGGER.info(
        "Got api request from %s with hardware id %s and request %s..",
        request.remote_addr,
        arg[1],
        arg[2][:20],
    )
    device = Device.query.get(hardware_id)
    if device is None:
        _LOGGER.warn(
            "Device with IP %s and hardware id %s is trying to communicate, but has not been registered.",
            request.remote_addr,
            arg[1],
        )
        return Response(response="no activated device", status=400)
    try:
        tsreq = parse_qs(decrypt_request(arg[2], device.password))
    except Exception:
        _LOGGER.warn(
            "Request from device with IP %s and hardware id %s cannot be decoded.",
            request.remote_addr,
            arg[1],
        )
        return Response(response="incorrect request", status=400)

    _LOGGER.info("Request %s:%s - %s", request.remote_addr, arg[1], tsreq | {"p": None})

    if device.log_opentherm:
        try:
            parsed_data = parse_message(
                device_hardware_id=hardware_id, raw_message=tsreq
            )
            db.session.add(ParsedMessage(**parsed_data))
        except Exception as e:
            _LOGGER.warn(
                "Could not write parsed message, falling back to raw storing: %s", e
            )
            db.session.add(DeviceMessage(device_hardware_id=hardware_id, message=tsreq))
        db.session.commit()

    if device.log_retention_days > 0:
        cutoff_date = datetime.now(timezone.utc) - timedelta(
            days=device.log_retention_days
        )
        num_deleted_parsed = (
            db.session.query(ParsedMessage)
            .filter(ParsedMessage.device_hardware_id == hardware_id)
            .filter(ParsedMessage.timestamp < cutoff_date)
            .delete()
        )
        num_deleted_raw = (
            db.session.query(DeviceMessage)
            .filter(DeviceMessage.device_hardware_id == hardware_id)
            .filter(DeviceMessage.timestamp < cutoff_date)
            .delete()
        )
        db.session.commit()
        _LOGGER.info(
            "%s parsed messages and %s raw messages deleted for device %s older than cutoff date: %s",
            num_deleted_parsed,
            num_deleted_raw,
            hardware_id,
            cutoff_date,
        )

    xml = "<ITHERMOSTAT>"
    if device.cal_synced is False:
        xml += "<CAL>"
        cal_version = device.cal_version + 1
        xml += "v{:04X}".format(cal_version & 0xFFFF)
        xml += _calendar_payload(device)
        xml += "</CAL>"
        device.cal_version = cal_version
        device.cal_synced = True
        db.session.commit()

    if int(tsreq["pv"][0]) != device.room_temperature:
        device.room_temperature = tsreq["pv"][0]
        db.session.commit()
        emit(
            "room_temperature",
            {"room_temperature": int(tsreq["pv"][0])},
            namespace="/",
            to=hardware_id,
        )

    if kp := tsreq.get("kp"):
        kp = float(kp[0])
        if kp != device.kp:
            device.kp = kp
            db.session.commit()
    if ti := tsreq.get("ti"):
        ti = float(ti[0])
        if ti != device.ti:
            device.ti = ti
            db.session.commit()
    if td := tsreq.get("td"):
        td = float(td[0])
        if td != device.td:
            device.td = td
            db.session.commit()
    boiler_changed = False

    if oo := tsreq.get("oo"):
        oo = int(oo[0])
        if oo != device.oo:
            device.oo = oo
            db.session.commit()
            boiler_changed = True

    otparams = [
        "ot0",
        "ot1",
        "ot3",
        "ot17",
        "ot18",
        "ot19",
        "ot25",
        "ot26",
        "ot27",
        "ot28",
        "ot34",
        "ot56",
        "ot125",
    ]
    otchanged = False
    for param in otparams:
        if param in tsreq:
            otvalue = int(tsreq[param][0], 16)
            if otvalue != 0xDEAD and otvalue != getattr(device, param):
                setattr(device, param, otvalue)
                otchanged = True
    if otchanged:
        db.session.commit()
        boiler_changed = True

    if boiler_changed:
        emit(
            "broadcast-thermostat",
            _boiler_realtime_patch(device),
            namespace="/",
            to=hardware_id,
        )

    hw = int(tsreq["hw"][0])
    if hw != device.hw:
        device.hw = hw
        db.session.commit()

    fw = int(tsreq["fw"][0][1:]) if hw == 5 else int(tsreq["fw"][0])
    if fw != device.fw:
        device.fw = fw
        db.session.commit()

    # if firmware_upgrade_needed(hw, fw):
    #     xml += "<FW>1</FW>"

    if int(tsreq["pv"][0]) != device.room_temperature:
        device.room_temperature = tsreq["pv"][0]
        db.session.commit()
        emit(
            "room_temperature",
            {"room_temperature": int(tsreq["pv"][0])},
            namespace="/",
            to=hardware_id,
        )

    if (
        not device.outside_temperature_timestamp
        or datetime.fromtimestamp(device.outside_temperature_timestamp)
        + timedelta(seconds=3600)
        < datetime.utcnow()
    ):
        location = Location.query.filter_by(id=device.location_id).one()
        if location is None:
            return Response(response="no location", status=400)
        response = requests.request(
            "GET",
            "https://api.tomorrow.io/v4/weather/realtime",
            params={
                "location": f"{location.latitude}, {location.longitude}",
                "apikey": TOMORROW_APIKEY,
            },
        )
        response = json.loads(response.text)
        outside_temperature = int(response["data"]["values"]["temperature"] * 10)
        xml += f"<BVSET>{outside_temperature}</BVSET>"
        emit(
            "outside_temperature",
            {
                "location": location.city,
                "outside_temperature": outside_temperature,
                "outside_temperature_icon": None,
            },
            namespace="/",
            to=hardware_id,
        )
        device.outside_temperature = outside_temperature
        device.outside_temperature_timestamp = calendar.timegm(time.gmtime())
        db.session.commit()

    if "init" in tsreq:
        pause = int(device.source == Source.PAUSE.value)
        xml += f"<PAUSE>{pause}</PAUSE>"
        xml += (
            f"<INIT><SRC>{device.source}</SRC><LOCALE>{device.locale}</LOCALE></INIT>"
        )
        xml += f"<SVSET>{device.target_temperature}</SVSET>"
        xml += f"<BVSET>{device.outside_temperature}</BVSET>"
        xml += f"<TA>{device.ta}</TA>"
        xml += f"<DIM>{device.dim}</DIM>"
        xml += f"<SLS>{device.sl}</SLS>"
        xml += f"<SD>{device.sd}</SD>"
        xml += (
            f"<PID><KP>{device.kp}</KP><TI>{device.ti}</TI><TD>{device.td}</TD></PID>"
        )
    elif device.ui_synced is False:
        if device.ui_source in ("pause_button", "api_pause_button"):
            pause = int(device.source == Source.PAUSE.value)
            xml += f"<PAUSE>{pause}</PAUSE>"
            xml += f"<INIT><SRC>{device.source}</SRC></INIT>"
        elif device.ui_source in (
            "direct_temperature_setter_up",
            "direct_temperature_setter_down",
            "api_temperature_setter",
        ):
            xml += "<PAUSE>0</PAUSE>"
            xml += f"<INIT><SRC>{device.source}</SRC></INIT>"
            xml += f"<SVSET>{device.target_temperature}</SVSET>"
        else:
            xml += f"<TA>{device.ta}</TA>"
            xml += f"<DIM>{device.dim}</DIM>"
            xml += f"<INIT><LOCALE>{device.locale}</LOCALE></INIT>"
            xml += f"<SLS>{device.sl}</SLS>"
            xml += f"<SD>{device.sd}</SD>"
        device.ui_synced = True
        db.session.commit()
    elif "src" in tsreq:
        tssrc = int(tsreq["src"][0])
        if (
            tssrc == Source.MANUAL.value
            and "csv" in tsreq
            and int(tsreq["csv"][0]) != device.target_temperature
        ):
            device.source = Source.MANUAL.value
            device.target_temperature = int(tsreq["csv"][0])
            db.session.commit()
            emit(
                "target_temperature",
                {"target_temperature": int(tsreq["csv"][0])},
                namespace="/",
                to=hardware_id,
            )
            emit("source", {"source": tssrc}, namespace="/", to=hardware_id)
        elif tssrc == Source.CRASH.value:
            device.source = Source.STD_WEEK.value
            db.session.commit()
            xml += "<PAUSE>0</PAUSE>"
            xml += f"<INIT><SRC>{Source.STD_WEEK.value}</SRC></INIT>"
            emit(
                "source",
                {"source": Source.STD_WEEK.value},
                namespace="/",
                to=hardware_id,
            )
        elif tssrc != device.source:
            device.source = tssrc
            db.session.commit()
            emit("source", {"source": tssrc}, namespace="/", to=hardware_id)

        if int(tsreq["csv"][0]) != device.target_temperature:
            device.target_temperature = int(tsreq["csv"][0])
            emit(
                "target_temperature",
                {"target_temperature": int(tsreq["csv"][0])},
                namespace="/",
                to=hardware_id,
            )

    updatetime = "ts" not in tsreq or abs(int(tsreq["ts"][0]) - int(time.time())) > 60
    if updatetime:
        xml += f"<TS>{int(time.time())}</TS>"

    xml += f"<TZ>{int(device.utc_offset_in_seconds() / 60)}</TZ>"
    xml += "</ITHERMOSTAT>"
    _LOGGER.info("Response %s:%s - %s", request.remote_addr, arg[1], xml)
    data = encrypt_response(xml, device.password)
    return Response(response=data, status=200, mimetype="application/octet-stream")


@ts.route("/thermostat/<device_id>", methods=["GET", "PUT"])
def thermostat(device_id):
    device = Device.query.get(device_id)
    if device is None:
        return Response(response="no activated device", status=400)

    if request.method == "GET":
        current_source = device.source
        target_temperature = _tenths_to_celsius(device.target_temperature)
        now_tz_aware = device.get_now_tz_aware()
        schedule_preset = device.get_exception_predefined_label(now_tz_aware)

        if schedule_preset != "none":
            current_source = Source.EXCEPTION.value
            target_temperature = _tenths_to_celsius(
                device.predefined_temperatures.get(
                    schedule_preset, device.target_temperature
                )
            )
        elif current_source == Source.EXCEPTION.value:
            current_source = Source.STD_WEEK.value

        if current_source == Source.STD_WEEK.value:
            schedule_preset = device.get_std_week_predefined_label(now_tz_aware)
            target_temperature = _tenths_to_celsius(
                device.predefined_temperatures.get(
                    schedule_preset, device.target_temperature
                )
            )

        data = {
            "name": device.hardware_id,
            "room_temperature": _tenths_to_celsius(device.room_temperature),
            "target_temperature": target_temperature,
            "outside_temperature": _tenths_to_celsius(device.outside_temperature),
            "source_name": _source_name(current_source),
            "schedule_preset": schedule_preset,
            "ui_source": device.ui_source,
            "firmware": device.fw,
            "ts_server_version": Config.TS_SERVER_VERSION,
            "ot": _opentherm_payload(
                device, include_raw=not _arg_is_true("excludeOpenThermRaw")
            ),
        }

        if not _arg_is_true("excludeSchedules"):
            data["predefined_temperatures"] = device.predefined_temperatures
            data["standard_week"] = device.standard_week
            data["exceptions"] = device.exceptions

        return jsonify(data)

    data = request.get_json(silent=True) or {}
    changed = False
    cal_changed = False

    if "target_temperature" in data:
        device.target_temperature = int(round(float(data["target_temperature"]) * 10))
        device.ui_source = "api_temperature_setter"
        device.source = Source.SERVER.value
        changed = True
    if "exceptions" in data:
        device.exceptions = data["exceptions"]
        changed = True
        cal_changed = True
    if "standard_week" in data:
        device.standard_week = data["standard_week"]
        changed = True
        cal_changed = True
    if "predefined_temperatures" in data:
        device.predefined_temperatures = data["predefined_temperatures"]
        changed = True
        cal_changed = True
    if "dhw_programs" in data:
        device.dhw_programs = data["dhw_programs"]
        changed = True
        cal_changed = True
    if "outside_temperature" in data:
        device.outside_temperature = int(round(float(data["outside_temperature"]) * 10))
        changed = True

    if changed:
        device.ui_synced = False
        if cal_changed:
            device.cal_synced = False
        db.session.commit()
        broadcast = {}
        if "target_temperature" in data:
            broadcast["target_temperature"] = device.target_temperature
            broadcast["source"] = device.source
        if "standard_week" in data:
            broadcast["standard_week"] = device.standard_week
        if "exceptions" in data:
            broadcast["exceptions"] = device.exceptions
        if broadcast:
            emit("broadcast-thermostat", broadcast, namespace="/", to=device_id)
        return Response(response="OK", status=200)

    return Response(response="Nothing to update", status=200)


@ts.route("/thermostat/<device_id>/pause", methods=["POST"])
def thermostat_pause(device_id):
    device = Device.query.get(device_id)
    if device is None:
        return Response(response="no activated device", status=400)

    device.ui_source = "api_pause_button"
    device.source = Source.PAUSE.value
    device.ui_synced = False
    db.session.commit()
    emit("broadcast-thermostat", {"source": device.source}, namespace="/", to=device_id)
    return Response(response="OK", status=200)


@ts.route("/thermostat/<device_id>/unpause", methods=["POST"])
def thermostat_unpause(device_id):
    device = Device.query.get(device_id)
    if device is None:
        return Response(response="no activated device", status=400)

    device.ui_source = "api_pause_button"
    device.source = Source.STD_WEEK.value
    device.ui_synced = False
    db.session.commit()
    emit("broadcast-thermostat", {"source": device.source}, namespace="/", to=device_id)
    return Response(response="OK", status=200)
