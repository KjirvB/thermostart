"""Add indexes for message retention queries

Revision ID: e1b0d6f4a9c2
Revises: bb495a090d1b
Create Date: 2026-05-01 19:25:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "e1b0d6f4a9c2"
down_revision = "bb495a090d1b"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_device_messages_device_hardware_id_timestamp",
        "device_messages",
        ["device_hardware_id", "timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_parsed_messages_device_hardware_id_timestamp",
        "parsed_messages",
        ["device_hardware_id", "timestamp"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_parsed_messages_device_hardware_id_timestamp",
        table_name="parsed_messages",
    )
    op.drop_index(
        "ix_device_messages_device_hardware_id_timestamp",
        table_name="device_messages",
    )
