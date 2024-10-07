import os

from dotenv import load_dotenv
from pathlib import Path

# Specify the path to your .env.dev file
dotenv_path = (Path("../../.."))/".env.dev"
load_dotenv(dotenv_path)


class Config:
    STATIC_FOLDER = f"{os.getenv('APP_FOLDER')}/thermostart/static"
    SECRET_KEY = os.environ.get("SECRET_KEY")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # In app values that are changeable via environment variables
    AI_MOVE_DELAY_SECONDS = float(os.getenv("AI_MOVE_DELAY_SECONDS", 1.5))

    APPLICATION_ROOT = os.getenv("APPLICATION_ROOT", "/")

    # Autologin feature, this is used by Home Assistant
    AUTOLOGIN_USERNAME = os.getenv("AUTOLOGIN_USERNAME", "")
    AUTOLOGIN_PASSWORD = os.getenv("AUTOLOGIN_PASSWORD", "")

    #Variables to enable store parsed messages and set the retention time in days. 0 for infinite
    PARSE_AND_STORE_MESSAGES = os.getenv("PARSE_AND_STORE_MESSAGES", "false").lower() == "true"
    MESSAGE_RETENTION_DAYS = int(os.getenv("MESSAGE_RETENTION_DAYS",0))
