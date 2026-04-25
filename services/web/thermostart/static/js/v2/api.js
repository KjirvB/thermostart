window.tsApi = {
  fetchModel: function () {
    return fetch("thermostatmodel", { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load model: " + r.status);
      return r.json();
    });
  },
  setUiPreference: function (version) {
    var body = new FormData();
    body.append("version", version);
    return fetch("ui/preference", {
      method: "POST",
      body: body,
      credentials: "same-origin",
    });
  },
  downloadFirmware: function (version) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = "firmware";
    var input = document.createElement("input");
    input.name = "version";
    input.value = String(version);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  },
};
