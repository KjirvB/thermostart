"""add log opentherm settings

Revision ID: bb495a090d1b
Revises: 2622e5a9fef8
Create Date: 2024-10-07 00:00:00

"""

import sqlalchemy as sa
from alembic import op
from thermostart.config import Config

# revision identifiers, used by Alembic.
revision = "bb495a090d1b"
down_revision = "2622e5a9fef8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "log_opentherm",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "log_retention_days", sa.Integer(), nullable=False, server_default="0"
            )
        )

    op.execute(
        f"UPDATE device SET log_opentherm={'1' if Config.PARSE_AND_STORE_MESSAGES else '0'}, "
        f"log_retention_days={Config.MESSAGE_RETENTION_DAYS}"
    )

    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.alter_column("log_opentherm", server_default=None)
        batch_op.alter_column("log_retention_days", server_default=None)


def downgrade():
    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.drop_column("log_retention_days")
        batch_op.drop_column("log_opentherm")
