'use strict';
var Hammer = require('hammer');

var HammerController = function(viewer) {
    this._enable = true;
    this._viewer = viewer;
    this._type = 'Hammer';

    this._eventNode = undefined;
};

HammerController.prototype = {
    setEnable: function(bool) {
        this._enable = bool;
    },

    getEnable: function() {
        return this._enable;
    },

    init: function(options) {
        /* eslint-disable camelcase */
        var deviceOptions = {
            prevent_default: true,
            drag_max_touches: 2,
            transform_min_scale: 0.08,
            transform_min_rotation: 180,
            transform_always_block: true,
            hold: false,
            release: false,
            swipe: false,
            tap: false
        };
        /* eslint-enable camelcase */

        this._eventNode = options.eventNode;

        if (this._eventNode) {
            this._hammer = new Hammer(this._eventNode, deviceOptions);

            if (options.getBoolean('scrollwheel') === false)
                this._hammer.get('pinch').set({
                    enable: false
                });
            else
                this._hammer.get('pinch').set({
                    enable: true
                });
        }
    },

    isValid: function() {
        if (this._enable && this.getManipulatorController()) {
            return true;
        }
        return false;
    },

    getManipulatorController: function() {
        var manip = this._viewer.getManipulator();
        return manip && manip.getControllerList()[this._type];
    },

    // use the update to set the input device to mouse controller
    // it's needed to compute size
    update: function() {
        var isValid = this.isValid();
        var manip = this.getManipulatorController();
        if (manip) manip.setValid(isValid);

        if (!isValid) return;

        // we pass directly hammer object
        this.getManipulatorController().setEventProxy(this._hammer);
    },
    remove: function() {
        if (!this.isValid()) return;
        this.getManipulatorController().removeEventProxy(this._hammer);
    }
};
module.exports = HammerController;
