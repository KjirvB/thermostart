var ts = window.ts || {};

ts.OpenThermSettings = Backbone.View.extend({
    events: {
        'change input[name="log_opentherm"]': 'toggleLogging',
        'change input[name="log_retention_days"]': 'changeRetention'
    },

    initialize: function() {
        this.listenTo(this.model, 'change:log_opentherm', this.updateCheckbox);
        this.listenTo(this.model, 'change:log_retention_days', this.updateRetention);
        this.updateCheckbox();
        this.updateRetention();
    },

    updateCheckbox: function() {
        this.$('input[name="log_opentherm"]').prop('checked', !!this.model.get('log_opentherm'));
    },

    updateRetention: function() {
        this.$('input[name="log_retention_days"]').val(this.model.get('log_retention_days'));
    },

    toggleLogging: function() {
        var val = this.$('input[name="log_opentherm"]').is(':checked');
        this.model.save({
            log_opentherm: val,
            ui_synced: false,
            ui_source: 'log_opentherm_toggle',
            ui_change_time: new Date,
            ui_change_browser: navigator.userAgent
        });
    },

    changeRetention: function() {
        var days = parseInt(this.$('input[name="log_retention_days"]').val(), 10) || 0;
        this.model.save({
            log_retention_days: days,
            ui_synced: false,
            ui_source: 'log_retention_days_input',
            ui_change_time: new Date,
            ui_change_browser: navigator.userAgent
        });
    }
});
