import json
import os
from functools import lru_cache

from flask import (
    Blueprint,
    abort,
    current_app,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required

from thermostart import db
from thermostart.models import Device, Location  # noqa: F401
from thermostart.ts.utils import (
    get_firmware,
    get_firmware_name,
    interpret_status,
    parse_f8_8,
)

ui = Blueprint("ui", __name__)


COOKIE_NAME = "ui_version"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year
DEFAULT_UI = "v2"


def _chosen_ui():
    """Return 'v2' or 'classic' based on the cookie. Defaults to v2 for new visitors."""
    val = request.cookies.get(COOKIE_NAME, DEFAULT_UI)
    return "classic" if val == "classic" else "v2"


def _build_thermostat_payload(device):
    """Shared shape returned by /thermostatmodel and injected into the v2 bootstrap."""
    return dict(
        exceptions=device.exceptions,
        room_temperature=device.room_temperature,
        outside_temperature=device.outside_temperature,
        outside_temperature_icon=None,
        predefined_temperatures=device.predefined_temperatures,
        predefined_labels=device.predefined_labels,
        target_temperature=device.target_temperature,
        standard_week=device.standard_week,
        source=device.source,
        ui_synced=device.ui_synced,
        ui_source=device.ui_source,
        ta=device.ta,
        dim=device.dim,
        locale=device.locale,
        host=device.host,
        port=device.port,
        sl=device.sl,
        sd=device.sd,
        dhw_programs=device.dhw_programs,
        fw=device.fw,
        hw=device.hw,
        utc_offset=device.utc_offset_in_seconds() / 3600,
        log_opentherm=device.log_opentherm,
        log_retention_days=device.log_retention_days,
        oo=device.oo,
        ot0=device.ot0,
        ot1=device.ot1,
        ot3=device.ot3,
        ot17=device.ot17,
        ot18=device.ot18,
        ot19=device.ot19,
        ot25=device.ot25,
        ot26=device.ot26,
        ot27=device.ot27,
        ot28=device.ot28,
        ot34=device.ot34,
        ot56=device.ot56,
        ot125=device.ot125,
        # Pre-decoded values for the v2 UI (raw f8.8 ints stay above for backwards compat).
        parsed_ot0=interpret_status(device.ot0) if device.ot0 else None,
        parsed_ot1=parse_f8_8(device.ot1) if device.ot1 else None,
        parsed_ot17=parse_f8_8(device.ot17) if device.ot17 else None,
        parsed_ot18=parse_f8_8(device.ot18) if device.ot18 else None,
        parsed_ot19=parse_f8_8(device.ot19) if device.ot19 else None,
        parsed_ot25=parse_f8_8(device.ot25) if device.ot25 else None,
        parsed_ot26=parse_f8_8(device.ot26) if device.ot26 else None,
        parsed_ot27=parse_f8_8(device.ot27) if device.ot27 else None,
        parsed_ot28=parse_f8_8(device.ot28) if device.ot28 else None,
        parsed_ot34=parse_f8_8(device.ot34) if device.ot34 else None,
        parsed_ot56=parse_f8_8(device.ot56) if device.ot56 else None,
        parsed_ot125=parse_f8_8(device.ot125) if device.ot125 else None,
    )


@lru_cache(maxsize=1)
def _vite_manifest_path():
    static_folder = current_app.static_folder
    # Vite 5 emits the manifest under .vite/manifest.json by default.
    candidate = os.path.join(static_folder, "v2", ".vite", "manifest.json")
    if os.path.exists(candidate):
        return candidate
    # Fallback for older configs.
    return os.path.join(static_folder, "v2", "manifest.json")


def _read_vite_manifest():
    """Return (entry_js, [css_files]) for the v2 React bundle. Cached in non-debug mode."""
    path = _vite_manifest_path()
    if not os.path.exists(path):
        # Build hasn't been produced yet; surface a clear error.
        abort(
            500,
            description=(
                "v2 frontend bundle not built. Run `cd services/web/frontend && "
                "npm install && npm run build`."
            ),
        )
    with open(path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    entry = manifest.get("src/main.jsx")
    if not entry:
        abort(500, description="v2 manifest missing src/main.jsx entry")
    return entry["file"], list(entry.get("css", []))


@ui.route("/ui")
@login_required
def home():
    if _chosen_ui() == "v2":
        return redirect(url_for("ui.v2_home"))
    return render_template("ui.html")


@ui.route("/ui/v2")
@login_required
def v2_home():
    entry, css = _read_vite_manifest()
    return render_template(
        "v2/index.html",
        v2_entry=entry,
        v2_css=css,
        initial_state=_build_thermostat_payload(current_user),
        device_id=current_user.get_id(),
    )


@ui.route("/ui/switch")
@login_required
def switch_ui():
    target = request.args.get("to", DEFAULT_UI)
    if target not in ("v2", "classic"):
        target = DEFAULT_UI
    resp = make_response(redirect(url_for("ui.home")))
    resp.set_cookie(
        COOKIE_NAME,
        target,
        max_age=COOKIE_MAX_AGE,
        samesite="Lax",
        httponly=False,
    )
    return resp


@ui.route("/thermostatmodel")
@login_required
def thermostatmodel():
    return jsonify(_build_thermostat_payload(current_user))


# Allowlisted setting fields that the v2 UI can update via session auth.
# Mutations that touch the schedule, exceptions, or target temperature go through
# the HA-friendly /thermostat/<device_id> API instead — keep this surface minimal.
_ALLOWED_SETTINGS = {
    "ta": int,
    "dim": int,
    "sl": int,
    "sd": int,
    "locale": str,
    "host": str,
    "port": int,
    "log_opentherm": bool,
    "log_retention_days": int,
}


@ui.route("/ui/v2/api/settings", methods=["PUT"])
@login_required
def v2_update_settings():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        abort(400, description="expected JSON object")

    device = Device.query.get(current_user.get_id())
    if device is None:
        abort(404)

    applied = {}
    for key, value in payload.items():
        if key not in _ALLOWED_SETTINGS:
            continue
        coerce = _ALLOWED_SETTINGS[key]
        try:
            if coerce is bool:
                coerced = bool(value)
            else:
                coerced = coerce(value)
        except (TypeError, ValueError):
            abort(400, description=f"invalid value for {key}")
        setattr(device, key, coerced)
        applied[key] = coerced

    if applied:
        device.ui_synced = False
        device.ui_source = "v2-settings"
        if any(k in applied for k in ("ta", "dim", "sl", "sd")):
            device.cal_synced = False
        db.session.commit()

    return jsonify(applied)


@ui.route("/firmware", methods=["POST"])
@login_required
def firmware():
    version = int(request.form["version"])
    filename = get_firmware_name(version, True)
    patch = {
        "hostname": current_user.host,
        "port": current_user.port,
        "replace_yourowl.com": True,
    }
    data = get_firmware(version, patch)
    response = make_response(data)
    response.headers.set("Content-Type", "text/plain")
    response.headers.set("Content-Disposition", "attachment", filename=filename)
    return response
