var MACROUTILS = require('osg/Utils');
var notify = require('osg/notify');
var BlendFunc = require('osg/BlendFunc');
var Camera = require('osg/Camera');
var CullFace = require('osg/CullFace');
var Depth = require('osg/Depth');
var Node = require('osg/Node');
var Program = require('osg/Program');
var Shader = require('osg/Shader');
var Transform = require('osg/Transform');
var Texture = require('osg/Texture');
var mat4 = require('osg/glMatrix').mat4;
var BufferStats = require('osgStats/BufferStats');
var Counter = require('osgStats/Counter');
var TextGenerator = require('osgStats/TextGenerator');

var MaxGraphValue = 120;
var Graph = function() {
    this._values = new Float32Array(MaxGraphValue);
    this._index = 0;
    this._maxValue = 0.0;
    this._x = 0;
    this._y = 0;
};

Graph.prototype = {
    addValue: function(value) {
        var index = this._index;
        this._maxValue = value > this._maxValue ? value : this._maxValue;
        this._maxValue *= 0.99;
        this._values[index] = value / (this._maxValue * 1.1);
        this._index = (this._index + 1) % MaxGraphValue;
    },
    computeMax: function() {
        return this.computeMedian();
        this._maxValue = 0.0;
        for (var i = 0; i < MaxGraphValue; i++) {
            var value = this._values[i];
            this._maxValue = value > this._maxValue ? value : this._maxValue;
        }
    },
    computeRunningMean: function(average, value, index) {
        var mean = (average + (index - 1) + value) / index;
        return mean * 2.0;
    },
    computeMovingMean: function(average, value, alpha) {
        var mean = alpha * value + (1.0 - alpha) * average;
        return mean * 2.0;
    },
    computeMedian: function() {
        var sortedArray = this._inputs.sort();
        var median = sortedArray[MaxGraphValue / 2];
        var max = median * 2.0;
        return max;
    }
};

var Stats = function(viewport, options) {
    this._captionsBuffer = undefined;
    this._valuesBuffer = undefined;

    this._dirtyCaptions = true;
    this._dirtyValues = true;

    this._counters = undefined;
    this._groups = undefined;

    this._labelMaxWidth = 0;
    this._viewport = viewport;

    this._node = undefined;
    this._text = undefined;
    this._offsetGroup = undefined;

    this._counters = {};
    this._groups = [];
    this._updates = [];

    this._x = 0;
    this._y = 0;
    this._width = 0;
    this._height = 0;

    this._lineFactor = 1.1;
    this._characterDisplayHeight = 32.0;

    this._displayFilter = [];

    this._backgroundWidth = 0;
    this._backgroundHeight = 0;

    this._graphToDisplay = [];

    this._init(viewport, options);
};

MACROUTILS.createPrototypeObject(Stats, {
    getCounter: function(name) {
        if (!this._counters[name]) {
            this._counters[name] = new Counter({
                caption: name,
                average: true
            });
        }

        return this._counters[name];
    },
    addConfig: function(config) {
        for (var valueName in config.values) {
            if (this._counters[valueName]) {
                notify.warn('Counter ' + valueName + ' already exist, overring it');
            }
            var valueConfig = config.values[valueName];
            var counter = new Counter(valueConfig);
            this._counters[valueName] = counter;
        }

        if (config.groups) {
            for (var i = 0; i < config.groups.length; i++) {
                var groupConfig = config.groups[i];
                var group = {
                    name: groupConfig.name ? groupConfig.name : groupConfig.caption,
                    caption: groupConfig.caption,
                    values: groupConfig.values
                };
                this._groups.push(group);
            }
        }

        if (config.update) {
            this._updates.push(config.update);
        }
    },
    update: function() {
        for (var i = 0; i < this._updates.length; i++) {
            this._updates[i](this);
        }
        this._dirtyValues = true;

        if (this._checkViewportChanged()) this._dirtyCaptions = true;

        if (this._dirtyCaptions) {
            this._bufferStats.resetCaptions();
            this._generateCaptions();
            this._dirtyCaptions = false;
        }

        if (this._dirtyValues) {
            this._bufferStats.resetValues();
            this._generateValues();
            this._dirtyValues = false;
        }
    },
    getNode: function() {
        return this._node;
    },
    setShowFilter: function(groupNamesArray) {
        this._dirtyCaptions = true;
        if (!groupNamesArray) {
            this._displayFilter.length = 0;
            return;
        }
        this._displayFilter = groupNamesArray.slice();
    },
    setFontSize: function(size) {
        this._characterDisplayHeight = size;
        this._dirtyCaptions = true;
    },
    _init: function(viewport, options) {
        // 3D init
        this._bufferStats = new BufferStats();
        this._historyGraph = {};

        this._viewport = viewport;
        var camera = new Camera();

        camera.setRenderOrder(Camera.POST_RENDER, 0);
        camera.setReferenceFrame(Transform.ABSOLUTE_RF);
        camera.setClearMask(0x0); // dont clear anything
        var node = new Node();
        camera.addChild(node);
        camera.setName('osgStats');
        this._node = camera;

        this._text = new TextGenerator();

        if (options) {
            var statsGroupList = options.getString('statsFilter');
            if (statsGroupList) {
                var filterList = statsGroupList.split(';');
                this.setShowFilter(filterList);
            }
            var statsFontSize = options.getNumber('statsFontSize');
            if (statsFontSize !== undefined) this._characterDisplayHeight = statsFontSize;
        }

        var texture = new Texture();
        this._text._fontSize = this._characterDisplayHeight;
        this._text.getCanvas().then(
            function(canvas) {
                this._dirtyCaptions = true;
                node.addChild(this._bufferStats.getGeometry());
                texture.setImage(canvas);
            }.bind(this)
        );

        var program = (function() {
            var vertexshader = [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',
                'attribute vec3 Vertex;',
                'attribute vec2 TexCoord0;',
                'uniform mat4 uModelViewMatrix;',
                'uniform mat4 uProjectionMatrix;',
                '',
                'varying vec2 vTexCoord0;',
                '',
                'void main(void) {',
                '  gl_Position = uProjectionMatrix * (uModelViewMatrix * vec4(Vertex, 1.0));',
                '  vTexCoord0 = TexCoord0;',
                '}'
            ].join('\n');

            var fragmentshader = [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',
                'varying vec2 vTexCoord0;',
                'uniform sampler2D Texture0;',

                'void main(void) {',
                '  vec4 color;',
                '  if ( vTexCoord0.y <= -10.0 ) {', // background
                '     color = vec4(0.0,0.0,0.0,0.5);',
                '  } else if ( vTexCoord0.y <= -9.0 ) {', // graph
                '     color = vec4(1.0,0.0,0.0,1.0);',
                '  } else {',
                '     color = texture2D( Texture0, vTexCoord0.xy);',
                '  }',
                '  gl_FragColor = color;',
                '}'
            ].join('\n');

            return new Program(
                new Shader('VERTEX_SHADER', vertexshader),
                new Shader('FRAGMENT_SHADER', fragmentshader)
            );
        })();

        node.getOrCreateStateSet().setAttributeAndModes(program);
        node.getOrCreateStateSet().setAttributeAndModes(new CullFace(CullFace.DISABLE));
        node
            .getOrCreateStateSet()
            .setAttributeAndModes(new BlendFunc('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA'));
        node.getOrCreateStateSet().setAttributeAndModes(new Depth(Depth.DISABLE));
        node.getOrCreateStateSet().setTextureAttributeAndModes(0, texture);
    },
    _generateCaptions: function() {
        var initialX = 0;
        var characterHeight = this._text.getCharacterHeight();
        var textCursor = [initialX, this._viewport.height() - characterHeight, 0];
        this._labelMaxWidth = 0;

        // generate background
        this._bufferStats.generateBackground(
            0,
            this._viewport.height() - this._backgroundHeight,
            this._backgroundWidth,
            this._backgroundHeight
        );

        for (var i = 0; i < this._groups.length; i++) {
            var group = this._groups[i];
            var groupName = group.name;
            if (
                groupName &&
                this._displayFilter.length &&
                this._displayFilter.indexOf(groupName) === -1
            )
                continue;

            var groupText = '--- ' + group.caption + ' ---';
            var textWidth = this._bufferStats.generateText(textCursor, groupText, this._text);
            this._labelMaxWidth = Math.max(textWidth, this._labelMaxWidth);
            textCursor[0] = initialX;
            textCursor[1] -= this._lineFactor * characterHeight;

            for (var j = 0; j < group.values.length; j++) {
                var counterName = group.values[j];
                var counter = this._counters[counterName];
                if (!counter) continue;

                var text = counter._caption;
                textWidth = this._bufferStats.generateText(textCursor, text, this._text);
                this._labelMaxWidth = Math.max(textWidth, this._labelMaxWidth);
                textCursor[0] = initialX;
                textCursor[1] -= characterHeight;
            }
            textCursor[1] -= characterHeight;
        }
        this._bufferStats.captionsEnd();
    },
    _generateValues: function() {
        var characterWidth = this._text.getCharacterWidth();
        var valuesOffsetX = this._labelMaxWidth + 2 * characterWidth;
        var graphOffsetX = characterWidth * 6;
        var characterHeight = this._text.getCharacterHeight();
        var textCursor = [valuesOffsetX, this._viewport.height() - characterHeight, 0];

        for (var i = 0; i < this._groups.length; i++) {
            var group = this._groups[i];
            var groupName = group.name;
            if (
                groupName &&
                this._displayFilter.length &&
                this._displayFilter.indexOf(groupName) === -1
            )
                continue;

            textCursor[0] = valuesOffsetX;
            textCursor[1] -= this._lineFactor * characterHeight;

            for (var j = 0; j < group.values.length; j++) {
                var counterName = group.values[j];
                var counter = this._counters[counterName];
                if (!counter) continue;

                var value = counter._avgMs ? counter._averageValue : counter._value;
                var text;
                if (!Number.isInteger(value)) {
                    text = value.toFixed(2);
                } else {
                    text = value.toString();
                }

                this._bufferStats.generateText(textCursor, text, this._text);

                if (counter._graph) {
                    if (!this._historyGraph[counterName]) {
                        this._historyGraph[counterName] = new Graph();
                    }
                    this._graphToDisplay.push(this._historyGraph[counterName]);
                    this._historyGraph[counterName]._x = valuesOffsetX + graphOffsetX;
                    this._historyGraph[counterName]._y = textCursor[1];
                    this._historyGraph[counterName].addValue(value);
                }

                textCursor[0] = valuesOffsetX;
                textCursor[1] -= characterHeight;
            }
            textCursor[1] -= characterHeight;
        }

        this._bufferStats.valuesEnd();

        for (var g = 0; g < this._graphToDisplay.length; g++) {
            var graph = this._graphToDisplay[g];
            this._bufferStats.generateGraph(graph._x, graph._y, graph, characterHeight - 2.0);
        }

        var totalWidth = valuesOffsetX + graphOffsetX;

        if (this._graphToDisplay.length) totalWidth += MaxGraphValue * 2 + 1;
        var totalHeight = this._viewport.height() - textCursor[1] - 2 * characterHeight;

        if (this._backgroundWidth !== totalWidth || this._backgroundHeight !== totalHeight) {
            this._backgroundWidth = totalWidth;
            this._backgroundHeight = totalHeight;
            this._dirtyCaptions = true;
        }
        this._graphToDisplay.length = 0;

        this._bufferStats.graphsEnd();
        this._bufferStats.update();
    },
    _checkViewportChanged: function() {
        var x = this._viewport.x();
        var y = this._viewport.y();
        var w = this._viewport.width();
        var h = this._viewport.height();
        if (x !== this._x || y !== this._y || w !== this._width || h !== this._height) {
            this._x = x;
            this._y = y;
            this._width = w;
            this._height = h;

            var camera = this._node;
            mat4.ortho(
                camera.getProjectionMatrix(),
                this._x,
                this._width,
                this._y,
                this._height,
                -5,
                5
            );
            return true;
        }
        return false;
    }
});

module.exports = Stats;
