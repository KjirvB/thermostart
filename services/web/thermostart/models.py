import os
from datetime import datetime

import pytz
from flask_login import UserMixin
from sqlalchemy import JSON, DateTime
from sqlalchemy.ext.mutable import MutableDict, MutableList
from sqlalchemy.sql import func

from thermostart import db, login_manager
from thermostart.ts.utils import Display, Source, StatusLed


@login_manager.user_loader
def load_user(id):
    return Device.query.get(id)


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    country = db.Column(db.String(25), index=True)
    city = db.Column(db.String(40), index=True)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    timezone = db.Column(db.String(40))

    order = ["country", "city", "latitude", "longitude", "timezone"]

    def __repr__(self):
        return f"<Entry [{self.id}] {self.country} | {self.city}>"


class Device(UserMixin, db.Model):

    @staticmethod
    def get_default_dhw_programs():
        return []

    @staticmethod
    def get_default_exceptions():
        return []

    @staticmethod
    def get_default_predefined_temperatures():
        return {
            "anti_freeze": 50,
            "comfort": 215,
            "home": 180,
            "not_home": 150,
            "pause": 125,
        }

    @staticmethod
    def get_default_predefined_labels():
        return {
            "anti_freeze": "Anti freeze",
            "comfort": "Comfort",
            "home": "Home",
            "not_home": "Not home",
            "pause": "Pause",
        }

    @staticmethod
    def get_default_standard_week():
        return [
            {"start": [0, 6, 30], "temperature": "home"},
            {"start": [0, 7, 30], "temperature": "not_home"},
            {"start": [0, 17, 0], "temperature": "home"},
            {"start": [0, 20, 30], "temperature": "pause"},
            {"start": [1, 6, 30], "temperature": "home"},
            {"start": [1, 7, 30], "temperature": "not_home"},
            {"start": [1, 17, 0], "temperature": "home"},
            {"start": [1, 20, 30], "temperature": "pause"},
            {"start": [2, 6, 30], "temperature": "home"},
            {"start": [2, 7, 30], "temperature": "not_home"},
            {"start": [2, 17, 0], "temperature": "home"},
            {"start": [2, 20, 30], "temperature": "pause"},
            {"start": [3, 6, 30], "temperature": "home"},
            {"start": [3, 7, 30], "temperature": "not_home"},
            {"start": [3, 17, 0], "temperature": "home"},
            {"start": [3, 20, 30], "temperature": "pause"},
            {"start": [4, 6, 30], "temperature": "home"},
            {"start": [4, 7, 30], "temperature": "not_home"},
            {"start": [4, 17, 0], "temperature": "home"},
            {"start": [4, 20, 30], "temperature": "pause"},
            {"start": [5, 7, 30], "temperature": "home"},
            {"start": [5, 20, 30], "temperature": "pause"},
            {"start": [6, 7, 30], "temperature": "home"},
            {"start": [6, 20, 30], "temperature": "pause"},
        ]

    hardware_id = db.Column(db.String(20), primary_key=True)
    password = db.Column(db.String(20), index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("location.id"), nullable=False)
    exceptions = db.Column(MutableList.as_mutable(JSON), default=get_default_exceptions)
    predefined_temperatures = db.Column(
        MutableDict.as_mutable(JSON), default=get_default_predefined_temperatures
    )
    predefined_labels = db.Column(
        MutableDict.as_mutable(JSON), default=get_default_predefined_labels
    )
    standard_week = db.Column(
        MutableList.as_mutable(JSON), default=get_default_standard_week
    )
    dhw_programs = db.Column(
        MutableList.as_mutable(JSON), default=get_default_dhw_programs
    )
    ta = db.Column(db.Integer, default=0)  # no temperature adjustment
    dim = db.Column(db.Integer, default=100)  # leds on 100%
    sl = db.Column(db.Integer, default=StatusLed.ENABLED.value)
    sd = db.Column(db.Integer, default=Display.TEMPERATURE.value)
    locale = db.Column(db.String(10), default="en-GB")
    port = db.Column(db.Integer, default=os.getenv("FLASK_PORT", 3888))
    host = db.Column(db.String(17), default=os.getenv("FLASK_HOST", "yourhostname"))
    room_temperature = db.Column(db.Integer, default=0)
    outside_temperature = db.Column(db.Integer, default=0)
    outside_temperature_timestamp = db.Column(db.Integer, default=0)
    target_temperature = db.Column(db.Integer, default=0)
    source = db.Column(db.Integer, default=Source.STD_WEEK.value)
    ui_synced = db.Column(db.Boolean, default=False)
    ui_source = db.Column(db.String(40))
    fw = db.Column(db.Integer, default=0)
    hw = db.Column(db.Integer, default=0)
    cal_synced = db.Column(db.Boolean, default=False)
    cal_version = db.Column(db.Integer, default=1)
    creation_time = db.Column(DateTime(timezone=True), server_default=func.now())
    oo = db.Column(db.Integer, default=0)
    ot0 = db.Column(db.Integer, default=0)
    ot1 = db.Column(db.Integer, default=0)
    ot3 = db.Column(db.Integer, default=0)
    ot17 = db.Column(db.Integer, default=0)
    ot18 = db.Column(db.Integer, default=0)
    ot19 = db.Column(db.Integer, default=0)
    ot25 = db.Column(db.Integer, default=0)
    ot26 = db.Column(db.Integer, default=0)
    ot27 = db.Column(db.Integer, default=0)
    ot28 = db.Column(db.Integer, default=0)
    ot34 = db.Column(db.Integer, default=0)
    ot56 = db.Column(db.Integer, default=0)
    ot125 = db.Column(db.Integer, default=0)
    kp = db.Column(db.Float)
    ti = db.Column(db.Float)
    td = db.Column(db.Float)

    order = ["hardware_id", "password"]

    def __init__(self, hardware_id, password):
        self.hardware_id = hardware_id
        self.password = password

    def get_id(self):
        return self.hardware_id

    def utc_offset_in_seconds(self, date=None):
        location = Location.query.get(self.location_id)
        if location is not None:
            return pytz.timezone(location.timezone).utcoffset(datetime.now()).seconds
        else:
            return 0

    def __repr__(self):
        return f"<Entry [{self.hardware_id}] {self.source}>"


class DeviceMessage(db.Model):
    __tablename__ = "device_messages"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    device_hardware_id = db.Column(
        db.String, db.ForeignKey("device.hardware_id"), nullable=False
    )  # ForeignKey to Device model
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    message = db.Column(db.JSON, nullable=False)  # Store message as JSON

    def __repr__(self):
        return f"<DeviceMessage [{self.id}] from device_hardware_id {self.device_hardware_id} at {self.timestamp} with message '{self.message}'>"
class ParsedMessage(db.Model):
    __tablename__ = "parsed_messages"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    device_hardware_id = db.Column(
        db.String, db.ForeignKey("device.hardware_id"), nullable=False
    )  # ForeignKey to Device model
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    u = db.Column(db.String(50))
    p = db.Column(db.String(50), nullable=True)
    cv = db.Column(db.Integer)
    hw = db.Column(db.Integer)
    fw = db.Column(db.String(50))
    sv = db.Column(db.Integer)
    src = db.Column(db.Integer)
    pv = db.Column(db.Integer)
    hv = db.Column(db.Integer)
    th = db.Column(db.Integer)
    tc = db.Column(db.Integer)
    ot0 = db.Column(db.String(50))
    ot1 = db.Column(db.String(50))
    ot3 = db.Column(db.String(50))
    ot17 = db.Column(db.String(50))
    ot18 = db.Column(db.String(50))
    ot19 = db.Column(db.String(50))
    ot25 = db.Column(db.String(50))
    ot26 = db.Column(db.String(50))
    ot27 = db.Column(db.String(50))
    ot28 = db.Column(db.String(50))
    ot34 = db.Column(db.String(50))
    ot56 = db.Column(db.String(50))
    ot125 = db.Column(db.String(50))
    parsed_ot0 = db.Column(db.JSON, nullable=True)
    parsed_ot1 = db.Column(db.Float, nullable=True)
    parsed_ot3 = db.Column(db.JSON, nullable=True)
    parsed_ot17 = db.Column(db.Float, nullable=True)
    parsed_ot18 = db.Column(db.Float, nullable=True)
    parsed_ot19 = db.Column(db.Float, nullable=True)
    parsed_ot25 = db.Column(db.Float, nullable=True)
    parsed_ot26 = db.Column(db.Float, nullable=True)
    parsed_ot27 = db.Column(db.Float, nullable=True)
    parsed_ot28 = db.Column(db.Float, nullable=True)
    parsed_ot34 = db.Column(db.Float, nullable=True)
    parsed_ot56 = db.Column(db.Float, nullable=True)
    parsed_ot125 = db.Column(db.Float, nullable=True)
    otime = db.Column(db.Integer)
    kp = db.Column(db.Float)
    ti = db.Column(db.Float)
    td = db.Column(db.Float)
    frc = db.Column(db.Float)
    out = db.Column(db.Float)
    orx = db.Column(db.Integer)
    ot = db.Column(db.Integer)
    pd = db.Column(db.Float)
    dd = db.Column(db.Float)
    oo = db.Column(db.Integer)
    ta = db.Column(db.Integer)
    dim = db.Column(db.Integer)
    sl = db.Column(db.Integer)
    dv = db.Column(db.Integer)
    csv = db.Column(db.Integer)
    lrn = db.Column(db.Float)
    to = db.Column(db.Integer)
    ts = db.Column(db.Integer)
    sd = db.Column(db.Integer)
    hlp = db.Column(db.String(255))

    def __repr__(self):
        return f"<ParsedMessage [{self.id}] from device_hardware_id {self.device_hardware_id} at {self.timestamp}>"

