import json
import logging
import os

from flask import (
    Blueprint,
    current_app,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required, login_user, logout_user

from thermostart import db
from thermostart.auth.forms import LoginForm, RegistrationForm, UpdateAccountForm
from thermostart.config import Config
from thermostart.models import Device, Location

_LOGGER = logging.getLogger(__name__)
auth = Blueprint("auth", __name__)


def _v2_assets():
    """Return (entry_js, [css_files]) from the Vite manifest, or (None, []) on failure."""
    static = current_app.static_folder
    for candidate in [
        os.path.join(static, "v2", ".vite", "manifest.json"),
        os.path.join(static, "v2", "manifest.json"),
    ]:
        if os.path.exists(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                m = json.load(f)
            entry = m.get("src/main.jsx", {})
            return entry.get("file"), list(entry.get("css", []))
    return None, []


def _safe_next(next_url):
    """Return next_url if it is a safe relative path, else None."""
    if next_url and next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return None


@auth.route("/register", methods=["GET", "POST"])
def register_page():
    if current_user.is_authenticated:
        return redirect(url_for("main.homepage"))
    form = RegistrationForm()
    if request.method == "POST":
        form.city.query = (
            Location.query.with_entities(Location.id, Location.city)
            .filter_by(id=request.form["city"])
            .order_by(Location.city)
        )
    if form.validate_on_submit():
        device = Device(hardware_id=form.hardware_id.data, password=form.password.data)
        device.location_id = form.city.data.id
        db.session.add(device)
        db.session.commit()
        flash(
            f"Account has been created for you, {device.hardware_id}. You can now log in.",
            "success",
        )
        return redirect(url_for("auth.login_page"))
    return render_template("register.html", title="Sign Up", form=form)


@auth.route("/login", methods=["GET", "POST"])
def login_page():
    if len(Config.AUTOLOGIN_USERNAME) > 0 and len(Config.AUTOLOGIN_PASSWORD) > 0:
        device = Device.query.filter_by(hardware_id=Config.AUTOLOGIN_USERNAME).first()
        if not device:
            device = Device(
                hardware_id=Config.AUTOLOGIN_USERNAME,
                password=Config.AUTOLOGIN_PASSWORD,
            )
            device.location_id = 3145  # Default to Amsterdam
            db.session.add(device)
            db.session.commit()
        elif device.password != Config.AUTOLOGIN_PASSWORD:
            device.password = Config.AUTOLOGIN_PASSWORD
            db.session.commit()
        login_user(user=device)
        return redirect(url_for("ui.home"))
    else:
        form = LoginForm()
        next_url = _safe_next(request.args.get("next", ""))
        use_v2 = next_url is not None and next_url.startswith("/ui/v2")
        if form.validate_on_submit():
            device = Device.query.filter_by(hardware_id=form.hardware_id.data).first()
            try:
                if device and device.password == form.password.data:
                    login_user(user=device)
                    return redirect(next_url if next_url else url_for("ui.home"))
            except ValueError:
                pass
            flash(
                "Login unsuccessful. Please check your hardware ID and password.",
                "danger",
            )
        if use_v2:
            _, css = _v2_assets()
            return render_template(
                "v2/login.html", title="Sign in", form=form, v2_css=css
            )
        return render_template("login.html", title="Login", form=form)


@auth.route("/logout", methods=["GET"])
def logout():
    logout_user()
    flash("You have been logged out successfully.", "success")
    return redirect(url_for("auth.login_page"))


@auth.route("/account", methods=["GET", "POST"])
@login_required
def account_page():
    form = UpdateAccountForm(hardware_id=current_user)
    if request.method == "POST":
        location_id = request.form["city"]
    else:
        location_id = current_user.location_id

    country, city = (
        Location.query.with_entities(Location.country, Location.city)
        .filter_by(id=location_id)
        .order_by(Location.city)
        .one()
    )
    form.country.data = (country,)

    form.city.query = (
        Location.query.with_entities(Location.id, Location.city)
        .filter_by(country=country)
        .order_by(Location.city)
    )

    if request.method == "GET":
        form.city.data = (location_id, city)

    if form.validate_on_submit():
        current_user.location_id = form.city.data[0]
        current_user.password = form.password.data
        db.session.commit()
        flash("Your account has been updated.", "success")
        return redirect(url_for("auth.account_page"))
    elif request.method == "GET":
        form.hardware_id.data = current_user.hardware_id
    return render_template("account.html", title="Account", form=form)


@auth.route("/account-cities", methods=["POST"])
def cities():
    q = (
        Location.query.with_entities(Location.id, Location.city)
        .filter_by(country=request.form["country"])
        .order_by(Location.city)
    )
    result_dict = [u._asdict() for u in q.all()]
    return jsonify(result_dict)
