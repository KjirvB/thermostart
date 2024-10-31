"""Create parsed_messages table with foreign key to device

Revision ID: 2622e5a9fef8
Revises: 6a465cc4e610
Create Date: 2024-10-06 22:26:36.850201

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column
from sqlalchemy.orm import sessionmaker
import json

# revision identifiers, used by Alembic.
revision = "2622e5a9fef8"
down_revision = "6a465cc4e610"
branch_labels = None
depends_on = None

# Define the existing `device_messages` table to extract data from
device_messages = table(
    "device_messages",
    column("id", sa.Integer),
    column("device_hardware_id", sa.String),
    column("timestamp", sa.DateTime),
    column("message", sa.JSON),
)


def parse_f8_8(value):
    """
    Parses a 16-bit F8.8 fixed-point value (8 bits for integer, 8 bits for fractional part).
    """
    integer_part = int(value, 16) >> 8  # Top 8 bits
    fractional_part = int(value, 16) & 0xFF  # Bottom 8 bits
    return integer_part + fractional_part / 256.0


def interpret_status(hex_value):
    # Convert the hex string to an integer
    value = int(hex_value, 16)

    # Masks
    master_mask = 0xFF00
    slave_mask = 0x00FF

    # Extract master and slave status flags
    master_status = (value & master_mask) >> 8
    slave_status = value & slave_mask

    # Interpret master status flags
    master_flags = [
        "CH enable",
        "DHW enable",
        "Cooling enable",
        "OTC active",
        "CH2 enable",
        "Summer/winter mode",
        "DHW blocking",
    ]

    master_status_meaning = {
        flag: (master_status & (1 << i)) >> i for i, flag in enumerate(master_flags)
    }

    # Interpret slave status flags
    slave_flags = [
        "Fault indication",
        "CH mode",
        "DHW mode",
        "Flame status",
        "Cooling status",
        "CH2 mode",
        "Diagnostic/service indication",
        "Electricity production",
    ]

    slave_status_meaning = {
        flag: (slave_status & (1 << i)) >> i for i, flag in enumerate(slave_flags)
    }

    return {
        "master_status": master_status_meaning,
        "slave_status": slave_status_meaning,
    }


def interpret_slave_config(hex_value):
    # Convert the hex string to an integer
    value = int(hex_value, 16)

    # Masks
    slave_config_mask = 0xFF00
    slave_member_id_mask = 0x00FF

    # Extract master and slave status flags
    slave_config = (value & slave_config_mask) >> 8
    slave_member_id = value & slave_member_id_mask

    # Interpret master status flags
    slave_config_flags = [
        "DHW present",
        "Control type",
        "Cooling configuration",
        "DHW configuration",
        "Master low-off&pump control",
        "CH2 present",
        "Remote water filling function",
        "Heat/cool mode control",
    ]

    slave_config_meaning = {
        flag: (slave_config & (1 << i)) >> i
        for i, flag in enumerate(slave_config_flags)
    }

    return {"slave_config": slave_config_meaning, "slave_member_id": slave_member_id}


def parse_message_data(message):
    data_types = {
        "ot0": "flags",  # ID 0: Master status flags / Slave status flags
        "ot1": "f8.8",  # ID 1: CH water temperature control setpoint (°C)
        "ot3": "flags.u8",  # ID 3: Slave configuration flags / Slave member ID code
        "ot17": "f8.8",  # ID 17: Relative modulation level (%)
        "ot18": "f8.8",  # ID 18: Water pressure in CH circuit (bar)
        "ot19": "f8.8",  # ID 19: Water flow rate in DHW circuit (litres/minute)
        "ot25": "f8.8",  # ID 25: Flow water temperature from boiler (°C)
        "ot26": "f8.8",  # ID 26: Domestic hot water temperature (°C)
        "ot27": "f8.8",  # ID 27: Outside air temperature (°C)
        "ot28": "f8.8",  # ID 28: Return water temperature to boiler (°C)
        "ot34": "f8.8",  # ID 34: Boiler heat exchanger temperature (°C)
        "ot56": "f8.8",  # ID 56: DHW setpoint (Domestic hot water temperature setpoint, °C)
        "ot125": "f8.8",  # ID 125: Implemented version of OpenTherm in the slave
    }
    """Parses the message JSON to extract values for ParsedMessage fields."""
    parsed_data = {}
    try:
        for key in [
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
        ]:
            value = message.get(key, [None])[0]
            if value and value != "0xdead":
                data_type = data_types.get(key)
                if data_type == "f8.8":
                    parsed_value = parse_f8_8(value)
                elif data_type == "flags":
                    parsed_value = interpret_status(value)
                elif data_type == "flags.u8":
                    parsed_value = interpret_slave_config(value)
                else:
                    parsed_value = None  # Placeholder for other parsing logic
                    # Serialize dictionary fields to JSON string if applicable
                if isinstance(parsed_value, dict):
                    parsed_value = json.dumps(parsed_value)
                parsed_data[f"parsed_{key}"] = parsed_value

        parsed_data["u"] = message.get("u", [None])[0]
        parsed_data["p"] = message.get("p", [None])[0]
        parsed_data["cv"] = int(message.get("cv", [0])[0])
        parsed_data["hw"] = int(message.get("hw", [0])[0])
        parsed_data["fw"] = message.get("fw", [None])[0]
        parsed_data["sv"] = int(message.get("sv", [0])[0])
        parsed_data["src"] = int(message.get("src", [0])[0])
        parsed_data["pv"] = int(message.get("pv", [0])[0])
        parsed_data["hv"] = int(message.get("hv", [0])[0])
        parsed_data["th"] = int(message.get("th", [0])[0])
        parsed_data["tc"] = int(message.get("tc", [0])[0])
        parsed_data["ot0"] = message.get("ot0", [None])[0]
        parsed_data["ot1"] = message.get("ot1", [None])[0]
        parsed_data["ot3"] = message.get("ot3", [None])[0]
        parsed_data["ot17"] = message.get("ot17", [None])[0]
        parsed_data["ot18"] = message.get("ot18", [None])[0]
        parsed_data["ot19"] = message.get("ot19", [None])[0]
        parsed_data["ot25"] = message.get("ot25", [None])[0]
        parsed_data["ot26"] = message.get("ot26", [None])[0]
        parsed_data["ot27"] = message.get("ot27", [None])[0]
        parsed_data["ot28"] = message.get("ot28", [None])[0]
        parsed_data["ot34"] = message.get("ot34", [None])[0]
        parsed_data["ot56"] = message.get("ot56", [None])[0]
        parsed_data["ot125"] = message.get("ot125", [None])[0]
        parsed_data["otime"] = int(message.get("otime", [0])[0])
        parsed_data["kp"] = float(message.get("kp", [0.0])[0])
        parsed_data["ti"] = float(message.get("ti", [0.0])[0])
        parsed_data["td"] = float(message.get("td", [0.0])[0])
        parsed_data["frc"] = float(message.get("frc", [0])[0])
        parsed_data["out"] = float(message.get("out", [0.0])[0])
        parsed_data["orx"] = int(message.get("orx", [0])[0])
        parsed_data["ot"] = int(message.get("ot", [0])[0])
        parsed_data["pd"] = float(message.get("pd", [0.0])[0])
        parsed_data["dd"] = float(message.get("dd", [0.0])[0])
        parsed_data["oo"] = int(message.get("oo", [0])[0])
        parsed_data["ta"] = int(message.get("ta", [0])[0])
        parsed_data["dim"] = int(message.get("dim", [0])[0])
        parsed_data["sl"] = int(message.get("sl", [0])[0])
        parsed_data["dv"] = int(message.get("dv", [0])[0])
        parsed_data["csv"] = int(message.get("csv", [0])[0])
        parsed_data["lrn"] = float(message.get("lrn", [0])[0])
        parsed_data["to"] = int(message.get("to", [0])[0])
        parsed_data["ts"] = int(message.get("ts", [0])[0])
        parsed_data["sd"] = int(message.get("sd", [0])[0])
        parsed_data["hlp"] = message.get("hlp", [None])[0]

    except Exception as e:
        print(f"Error parsing message data: {e}")
    return parsed_data


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "parsed_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("device_hardware_id", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("u", sa.String(length=50), nullable=True),
        sa.Column("p", sa.String(length=50), nullable=True),
        sa.Column("cv", sa.Integer(), nullable=True),
        sa.Column("hw", sa.Integer(), nullable=True),
        sa.Column("fw", sa.String(length=50), nullable=True),
        sa.Column("sv", sa.Integer(), nullable=True),
        sa.Column("src", sa.Integer(), nullable=True),
        sa.Column("pv", sa.Integer(), nullable=True),
        sa.Column("hv", sa.Integer(), nullable=True),
        sa.Column("th", sa.Integer(), nullable=True),
        sa.Column("tc", sa.Integer(), nullable=True),
        sa.Column("ot0", sa.String(length=50), nullable=True),
        sa.Column("ot1", sa.String(length=50), nullable=True),
        sa.Column("ot3", sa.String(length=50), nullable=True),
        sa.Column("ot17", sa.String(length=50), nullable=True),
        sa.Column("ot18", sa.String(length=50), nullable=True),
        sa.Column("ot19", sa.String(length=50), nullable=True),
        sa.Column("ot25", sa.String(length=50), nullable=True),
        sa.Column("ot26", sa.String(length=50), nullable=True),
        sa.Column("ot27", sa.String(length=50), nullable=True),
        sa.Column("ot28", sa.String(length=50), nullable=True),
        sa.Column("ot34", sa.String(length=50), nullable=True),
        sa.Column("ot56", sa.String(length=50), nullable=True),
        sa.Column("ot125", sa.String(length=50), nullable=True),
        sa.Column("parsed_ot0", sa.JSON(), nullable=True),
        sa.Column("parsed_ot1", sa.Float(), nullable=True),
        sa.Column("parsed_ot3", sa.JSON(), nullable=True),
        sa.Column("parsed_ot17", sa.Float(), nullable=True),
        sa.Column("parsed_ot18", sa.Float(), nullable=True),
        sa.Column("parsed_ot19", sa.Float(), nullable=True),
        sa.Column("parsed_ot25", sa.Float(), nullable=True),
        sa.Column("parsed_ot26", sa.Float(), nullable=True),
        sa.Column("parsed_ot27", sa.Float(), nullable=True),
        sa.Column("parsed_ot28", sa.Float(), nullable=True),
        sa.Column("parsed_ot34", sa.Float(), nullable=True),
        sa.Column("parsed_ot56", sa.Float(), nullable=True),
        sa.Column("parsed_ot125", sa.Float(), nullable=True),
        sa.Column("otime", sa.Integer(), nullable=True),
        sa.Column("kp", sa.Float(), nullable=True),
        sa.Column("ti", sa.Float(), nullable=True),
        sa.Column("td", sa.Float(), nullable=True),
        sa.Column("frc", sa.Float(), nullable=True),
        sa.Column("out", sa.Float(), nullable=True),
        sa.Column("orx", sa.Integer(), nullable=True),
        sa.Column("ot", sa.Integer(), nullable=True),
        sa.Column("pd", sa.Float(), nullable=True),
        sa.Column("dd", sa.Float(), nullable=True),
        sa.Column("oo", sa.Integer(), nullable=True),
        sa.Column("ta", sa.Integer(), nullable=True),
        sa.Column("dim", sa.Integer(), nullable=True),
        sa.Column("sl", sa.Integer(), nullable=True),
        sa.Column("dv", sa.Integer(), nullable=True),
        sa.Column("csv", sa.Integer(), nullable=True),
        sa.Column("lrn", sa.Float(), nullable=True),
        sa.Column("to", sa.Integer(), nullable=True),
        sa.Column("ts", sa.Integer(), nullable=True),
        sa.Column("sd", sa.Integer(), nullable=True),
        sa.Column("hlp", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(
            ["device_hardware_id"],
            ["device.hardware_id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Begin data migration from `device_messages` to `parsed_messages`
    bind = op.get_bind()
    session = sessionmaker(bind=bind)()

    try:
        # Select data from `device_messages`
        results = session.execute(
            sa.select(
                device_messages.c.id,
                device_messages.c.device_hardware_id,
                device_messages.c.timestamp,
                device_messages.c.message,
            )
        ).fetchall()

        # Iterate over the rows and parse the data to insert into `parsed_messages`
        for row in results:
            parsed_data = parse_message_data(row.message)

            # Insert the parsed data into `parsed_messages`
            session.execute(
                sa.text(
                    """
                    INSERT INTO parsed_messages (
                        id, device_hardware_id, timestamp, u, p, cv, hw, fw, sv, src, pv, hv, th, tc, 
                        ot0, ot1, ot3, ot17, ot18, ot19, ot25, ot26, ot27, ot28, ot34, ot56, ot125,
                        parsed_ot0, parsed_ot1, parsed_ot3, parsed_ot17, parsed_ot18, parsed_ot19, 
                        parsed_ot25, parsed_ot26, parsed_ot27, parsed_ot28, parsed_ot34, parsed_ot56, 
                        parsed_ot125, otime, kp, ti, td, frc, out, orx, ot, pd, dd, oo, ta, dim, sl, 
                        dv, csv, lrn, "to", ts, sd, hlp
                    )
                    VALUES (
                        :id, :device_hardware_id, :timestamp, :u, :p, :cv, :hw, :fw, :sv, :src, :pv, :hv, 
                        :th, :tc, :ot0, :ot1, :ot3, :ot17, :ot18, :ot19, :ot25, :ot26, :ot27, :ot28, 
                        :ot34, :ot56, :ot125, :parsed_ot0, :parsed_ot1, :parsed_ot3, :parsed_ot17, 
                        :parsed_ot18, :parsed_ot19, :parsed_ot25, :parsed_ot26, :parsed_ot27, :parsed_ot28, 
                        :parsed_ot34, :parsed_ot56, :parsed_ot125, :otime, :kp, :ti, :td, :frc, :out, 
                        :orx, :ot, :pd, :dd, :oo, :ta, :dim, :sl, :dv, :csv, :lrn, :to, :ts, :sd, :hlp
                    )
                """
                ),
                {
                    "id": row.id,
                    "device_hardware_id": row.device_hardware_id,
                    "timestamp": row.timestamp,
                    "u": parsed_data.get("u"),
                    "p": parsed_data.get("p"),
                    "cv": parsed_data.get("cv"),
                    "hw": parsed_data.get("hw"),
                    "fw": parsed_data.get("fw"),
                    "sv": parsed_data.get("sv"),
                    "src": parsed_data.get("src"),
                    "pv": parsed_data.get("pv"),
                    "hv": parsed_data.get("hv"),
                    "th": parsed_data.get("th"),
                    "tc": parsed_data.get("tc"),
                    "ot0": parsed_data.get("ot0"),
                    "ot1": parsed_data.get("ot1"),
                    "ot3": parsed_data.get("ot3"),
                    "ot17": parsed_data.get("ot17"),
                    "ot18": parsed_data.get("ot18"),
                    "ot19": parsed_data.get("ot19"),
                    "ot25": parsed_data.get("ot25"),
                    "ot26": parsed_data.get("ot26"),
                    "ot27": parsed_data.get("ot27"),
                    "ot28": parsed_data.get("ot28"),
                    "ot34": parsed_data.get("ot34"),
                    "ot56": parsed_data.get("ot56"),
                    "ot125": parsed_data.get("ot125"),
                    "parsed_ot0": parsed_data.get("parsed_ot0"),
                    "parsed_ot1": parsed_data.get("parsed_ot1"),
                    "parsed_ot3": parsed_data.get("parsed_ot3"),
                    "parsed_ot17": parsed_data.get("parsed_ot17"),
                    "parsed_ot18": parsed_data.get("parsed_ot18"),
                    "parsed_ot19": parsed_data.get("parsed_ot19"),
                    "parsed_ot25": parsed_data.get("parsed_ot25"),
                    "parsed_ot26": parsed_data.get("parsed_ot26"),
                    "parsed_ot27": parsed_data.get("parsed_ot27"),
                    "parsed_ot28": parsed_data.get("parsed_ot28"),
                    "parsed_ot34": parsed_data.get("parsed_ot34"),
                    "parsed_ot56": parsed_data.get("parsed_ot56"),
                    "parsed_ot125": parsed_data.get("parsed_ot125"),
                    "otime": parsed_data.get("otime"),
                    "kp": parsed_data.get("kp"),
                    "ti": parsed_data.get("ti"),
                    "td": parsed_data.get("td"),
                    "frc": parsed_data.get("frc"),
                    "out": parsed_data.get("out"),
                    "orx": parsed_data.get("orx"),
                    "ot": parsed_data.get("ot"),
                    "pd": parsed_data.get("pd"),
                    "dd": parsed_data.get("dd"),
                    "oo": parsed_data.get("oo"),
                    "ta": parsed_data.get("ta"),
                    "dim": parsed_data.get("dim"),
                    "sl": parsed_data.get("sl"),
                    "dv": parsed_data.get("dv"),
                    "csv": parsed_data.get("csv"),
                    "lrn": parsed_data.get("lrn"),
                    "to": parsed_data.get("to"),
                    "ts": parsed_data.get("ts"),
                    "sd": parsed_data.get("sd"),
                    "hlp": parsed_data.get("hlp"),
                },
            )
        # Commit the transaction
        session.commit()
    finally:
        session.close()
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("parsed_messages")
    # ### end Alembic commands ###
