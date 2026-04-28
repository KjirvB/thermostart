from thermostart import create_app


class TestBasicRoutesAnonymous:
    def test_homepage(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert b"Homepage</title>" in response.data

    def test_about_page(self, client):
        response = client.get("/about")
        assert response.status_code == 200
        assert b"About page</title>" in response.data

    def test_404_page(self, client):
        response = client.get("/not_existing_page")
        assert response.status_code == 404
        assert b"(404)" in response.data


class TestUserRoutesAnonymous:
    def test_login_page(self, client):
        response = client.get("/login")
        assert response.status_code == 200
        assert b"Login</title>" in response.data

    def test_account_page_redirects(self, client):
        response = client.get("/account")
        assert response.status_code == 302
        assert b'href="/login?next=%2Faccount"' in response.data

    def test_register_page(self, client):
        response = client.get("/register")
        assert response.status_code == 200
        assert b"Register</title>" in response.data

    def test_logout_page(self, client):
        response = client.get("/logout")
        assert response.status_code == 302
        assert b'href="/"' in response.data


class TestGamesRoutesAnonymous:
    def test_sessions_get_redirects(self, client):
        response = client.get("/sessions")
        assert response.status_code == 302
        assert b'href="/login?next=%2Fsessions"' in response.data

    def test_stats_get_redirects(self, client):
        response = client.get("/stats")
        assert response.status_code == 302
        assert b'href="/login?next=%2Fstats"' in response.data

    def test_sessions_trailing_slash_404(self, client):
        response = client.get("/sessions/")
        assert response.status_code == 404

    def test_game_session_get_redirects(self, client):
        response = client.get("/sessions/1")
        assert response.status_code == 404

    def test_game_session_post_raises_exception(self, client):
        response = client.post("/sessions/1")
        assert response.status_code == 404

    def test_game_get_redirects(self, client):
        response = client.get("/game/1")
        assert response.status_code == 302
        assert b'href="/login?next=%2Fgame%2F1"' in response.data


class TestUserRoutesLoggedUser:
    def test_login_page(self, client):
        response = client.get("/login")
        assert response.status_code == 200
        assert b"Login</title>" in response.data

    def test_account_page_redirects(self, client):
        response = client.get("/account")
        assert response.status_code == 302
        assert b'href="/login?next=%2Faccount"' in response.data


class TestThermostatModel:
    def setup_method(self):
        from thermostart import db, fill_location_db
        from thermostart.models import Device
        from thermostart.config import Config

        self.app = create_app()
        self.app.config.update(
            {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"}
        )
        with self.app.app_context():
            db.create_all()
            fill_location_db(self.app)
            device = Device(hardware_id="dev1", password="pwd")
            device.location_id = 1
            db.session.add(device)
            db.session.commit()
        self.client = self.app.test_client()
        with self.client:
            self.client.post("/login", data={"hardware_id": "dev1", "password": "pwd"})

    def teardown_method(self):
        from thermostart import db

        with self.app.app_context():
            db.drop_all()

    def test_defaults_and_updates(self):
        from thermostart import db
        from thermostart.models import Device
        from thermostart.config import Config

        with self.client:
            resp = self.client.get("/thermostatmodel")
            data = resp.get_json()
            assert data["log_opentherm"] == Config.PARSE_AND_STORE_MESSAGES
            assert data["log_retention_days"] == Config.MESSAGE_RETENTION_DAYS

        with self.app.app_context():
            device = Device.query.get("dev1")
            device.log_opentherm = not Config.PARSE_AND_STORE_MESSAGES
            device.log_retention_days = 5
            db.session.commit()

        with self.client:
            resp = self.client.get("/thermostatmodel")
            data = resp.get_json()
            assert data["log_opentherm"] == (not Config.PARSE_AND_STORE_MESSAGES)
            assert data["log_retention_days"] == 5


class TestPruneMessages:
    def test_prune(self, app):
        from thermostart import db, fill_location_db
        from thermostart.models import Device, ParsedMessage
        from datetime import datetime, timedelta, timezone

        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        with app.app_context():
            db.create_all()
            fill_location_db(app)
            device = Device(
                hardware_id="dev2",
                password="pwd",
                log_opentherm=True,
                log_retention_days=1,
            )
            device.location_id = 1
            db.session.add(device)
            old_ts = datetime.now(timezone.utc) - timedelta(days=2)
            msg = ParsedMessage(device_hardware_id="dev2", timestamp=old_ts)
            db.session.add(msg)
            db.session.commit()

            cutoff = datetime.now(timezone.utc) - timedelta(
                days=device.log_retention_days
            )
            deleted = (
                db.session.query(ParsedMessage)
                .filter(ParsedMessage.timestamp < cutoff)
                .delete()
            )
            db.session.commit()

            assert deleted == 1
            assert ParsedMessage.query.count() == 0


class TestPublicThermostatApi:
    def setup_method(self):
        from thermostart import db
        from thermostart.models import Device, Location

        self.app = create_app()
        self.app.config.update(
            {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"}
        )
        with self.app.app_context():
            db.create_all()
            location = Location(
                id=1,
                country="NL",
                city="Amsterdam",
                latitude=52.37,
                longitude=4.89,
                timezone="Europe/Amsterdam",
            )
            device = Device(hardware_id="dev1", password="pwd")
            device.location_id = 1
            device.room_temperature = 204
            device.target_temperature = 205
            device.outside_temperature = 85
            device.fw = 30050046
            device.oo = 1
            device.ot0 = 0x010F
            device.ot3 = 0x0100
            device.ot18 = 448
            device.ot25 = 45 * 256
            device.ot28 = 37 * 256
            device.ot56 = 60 * 256
            device.standard_week = [
                {"start": [0, 0, 0], "temperature": "home"},
                {"start": [1, 0, 0], "temperature": "home"},
                {"start": [2, 0, 0], "temperature": "home"},
                {"start": [3, 0, 0], "temperature": "home"},
                {"start": [4, 0, 0], "temperature": "home"},
                {"start": [5, 0, 0], "temperature": "home"},
                {"start": [6, 0, 0], "temperature": "home"},
            ]
            device.predefined_temperatures = (
                Device.get_default_predefined_temperatures()
            )
            device.predefined_temperatures["home"] = 180
            db.session.add_all([location, device])
            db.session.commit()
        self.client = self.app.test_client()

    def teardown_method(self):
        from thermostart import db

        with self.app.app_context():
            db.drop_all()

    def test_get_full_response_uses_public_units_and_opentherm_fields(self):
        response = self.client.get("/thermostat/dev1")

        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "dev1"
        assert data["room_temperature"] == 20.4
        assert data["target_temperature"] == 18.0
        assert data["outside_temperature"] == 8.5
        assert data["source_name"] == "STD_WEEK"
        assert data["schedule_preset"] == "home"
        assert data["firmware"] == 30050046
        assert data["ts_server_version"] == "0.0.0"
        assert data["ot"]["enabled"] == 1
        assert data["ot"]["control_type"] == "modulating"
        assert data["ot"]["fault_indication"] is True
        assert data["ot"]["ch_enabled"] is True
        assert data["ot"]["ch_active"] is True
        assert data["ot"]["dhw_present"] is True
        assert data["ot"]["dhw_active"] is True
        assert data["ot"]["flame_on"] is True
        assert data["ot"]["dhw_setpoint_temperature"] == 60.0
        assert data["ot"]["boiler_water_temperature"] == 45.0
        assert data["ot"]["return_water_temperature"] == 37.0
        assert data["ot"]["boiler_pressure"] == 1.75
        assert data["ot"]["raw"]["ot18"] == 448
        assert "standard_week" in data
        assert "predefined_temperatures" in data
        assert "exceptions" in data

    def test_get_can_exclude_schedules_and_raw_opentherm(self):
        response = self.client.get(
            "/thermostat/dev1?excludeSchedules=1&excludeOpenThermRaw=true"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "standard_week" not in data
        assert "predefined_temperatures" not in data
        assert "exceptions" not in data
        assert "raw" not in data["ot"]

    def test_get_unknown_device(self):
        response = self.client.get("/thermostat/missing")

        assert response.status_code == 400
        assert response.text == "no activated device"

    def test_put_temperature_sets_internal_tenths_and_server_source(self):
        from thermostart import db
        from thermostart.models import Device
        from thermostart.ts.utils import Source

        response = self.client.put(
            "/thermostat/dev1", json={"target_temperature": 19.5}
        )

        assert response.status_code == 200
        assert response.text == "OK"
        with self.app.app_context():
            device = db.session.get(Device, "dev1")
            assert device.target_temperature == 195
            assert device.source == Source.SERVER.value
            assert device.ui_source == "api_temperature_setter"
            assert device.ui_synced is False

    def test_pause_and_unpause(self):
        from thermostart import db
        from thermostart.models import Device
        from thermostart.ts.utils import Source

        pause = self.client.post("/thermostat/dev1/pause")
        assert pause.status_code == 200
        with self.app.app_context():
            device = db.session.get(Device, "dev1")
            assert device.source == Source.PAUSE.value
            assert device.ui_source == "api_pause_button"
            assert device.ui_synced is False

        unpause = self.client.post("/thermostat/dev1/unpause")
        assert unpause.status_code == 200
        with self.app.app_context():
            device = db.session.get(Device, "dev1")
            assert device.source == Source.STD_WEEK.value
            assert device.ui_source == "api_pause_button"
            assert device.ui_synced is False


class TestDeviceScheduleHelpers:
    def setup_method(self):
        from thermostart import db
        from thermostart.models import Device, Location

        self.app = create_app()
        self.app.config.update(
            {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"}
        )
        with self.app.app_context():
            db.create_all()
            db.session.add(
                Location(
                    id=1,
                    country="NL",
                    city="Amsterdam",
                    latitude=52.37,
                    longitude=4.89,
                    timezone="Europe/Amsterdam",
                )
            )
            device = Device(hardware_id="dev1", password="pwd")
            device.location_id = 1
            db.session.add(device)
            db.session.commit()
        self.client = self.app.test_client()

    def teardown_method(self):
        from thermostart import db

        with self.app.app_context():
            db.drop_all()

    def test_std_week_preset(self):
        from datetime import datetime

        import pytz

        from thermostart import db
        from thermostart.models import Device

        with self.app.app_context():
            device = db.session.get(Device, "dev1")
            device.standard_week = [
                {"start": [0, 6, 30], "temperature": "home"},
                {"start": [0, 8, 0], "temperature": "not_home"},
            ]
            now = pytz.timezone("Europe/Amsterdam").localize(
                datetime(2026, 4, 27, 7, 0)
            )

            assert device.get_std_week_predefined_label(now) == "home"

    def test_active_exception_preset_with_24_hour_end(self):
        from datetime import datetime

        import pytz

        from thermostart import db
        from thermostart.models import Device

        with self.app.app_context():
            device = db.session.get(Device, "dev1")
            device.exceptions = [
                {
                    "start": [2026, 3, 28, 10, 0],
                    "end": [2026, 3, 28, 24, 0],
                    "temperature": "comfort",
                }
            ]
            now = pytz.timezone("Europe/Amsterdam").localize(
                datetime(2026, 4, 28, 23, 30)
            )

            assert device.get_exception_predefined_label(now) == "comfort"
