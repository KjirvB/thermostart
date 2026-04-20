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
        self.app.config.update({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
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
            device = Device(hardware_id="dev2", password="pwd", log_opentherm=True, log_retention_days=1)
            device.location_id = 1
            db.session.add(device)
            old_ts = datetime.now(timezone.utc) - timedelta(days=2)
            msg = ParsedMessage(device_hardware_id="dev2", timestamp=old_ts)
            db.session.add(msg)
            db.session.commit()

            cutoff = datetime.now(timezone.utc) - timedelta(days=device.log_retention_days)
            deleted = db.session.query(ParsedMessage).filter(ParsedMessage.timestamp < cutoff).delete()
            db.session.commit()

            assert deleted == 1
            assert ParsedMessage.query.count() == 0
