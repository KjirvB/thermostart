class TestOpenThermRetention:
    def test_prune_only_affects_current_device_and_both_message_tables(self, app):
        from datetime import datetime, timedelta, timezone

        from thermostart import db, fill_location_db
        from thermostart.models import Device, DeviceMessage, ParsedMessage

        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        with app.app_context():
            db.create_all()
            fill_location_db(app)

            device_a = Device("dev2", "x")
            device_a.location_id = 1
            device_a.log_opentherm = True
            device_a.log_retention_days = 1

            device_b = Device("dev3", "x")
            device_b.location_id = 1
            device_b.log_opentherm = True
            device_b.log_retention_days = 1

            db.session.add_all([device_a, device_b])
            db.session.commit()

            old_ts = datetime.now(timezone.utc) - timedelta(days=2)
            fresh_ts = datetime.now(timezone.utc)

            db.session.add_all(
                [
                    ParsedMessage(device_hardware_id="dev2", timestamp=old_ts),
                    ParsedMessage(device_hardware_id="dev2", timestamp=fresh_ts),
                    ParsedMessage(device_hardware_id="dev3", timestamp=old_ts),
                    DeviceMessage(
                        device_hardware_id="dev2", timestamp=old_ts, message={"a": 1}
                    ),
                    DeviceMessage(
                        device_hardware_id="dev2",
                        timestamp=fresh_ts,
                        message={"a": 2},
                    ),
                    DeviceMessage(
                        device_hardware_id="dev3", timestamp=old_ts, message={"b": 1}
                    ),
                ]
            )
            db.session.commit()

            cutoff = datetime.now(timezone.utc) - timedelta(
                days=device_a.log_retention_days
            )

            deleted_parsed = (
                db.session.query(ParsedMessage)
                .filter(ParsedMessage.device_hardware_id == "dev2")
                .filter(ParsedMessage.timestamp < cutoff)
                .delete()
            )
            deleted_raw = (
                db.session.query(DeviceMessage)
                .filter(DeviceMessage.device_hardware_id == "dev2")
                .filter(DeviceMessage.timestamp < cutoff)
                .delete()
            )
            db.session.commit()

            assert deleted_parsed == 1
            assert deleted_raw == 1
            assert (
                db.session.query(ParsedMessage)
                .filter(ParsedMessage.device_hardware_id == "dev2")
                .count()
                == 1
            )
            assert (
                db.session.query(DeviceMessage)
                .filter(DeviceMessage.device_hardware_id == "dev2")
                .count()
                == 1
            )
            assert (
                db.session.query(ParsedMessage)
                .filter(ParsedMessage.device_hardware_id == "dev3")
                .count()
                == 1
            )
            assert (
                db.session.query(DeviceMessage)
                .filter(DeviceMessage.device_hardware_id == "dev3")
                .count()
                == 1
            )
