var MACROUTILS = require('osg/Utils');
var BufferArray = require('osg/BufferArray');
var Geometry = require('osg/Geometry');
var primitiveSet = require('osg/primitiveSet');
var DrawElements = require('osg/DrawElements');
var DrawArrays = require('osg/DrawArrays');
var notify = require('osg/notify');

// captions data (4 vertexes, indexes)
// values data   (4 vertexes, indexes)
// graph data    (2 vertexes, drawArrays)

var backgroundUVy = -10; // uvs used to detect background color in shader
var graphUVy = -9; // uvs used to detect graph color in shader

var BufferStats = function() {
    this._usageHint = BufferArray.DYNAMIC_DRAW;
    // equivalent of 512 characters for caption, 128 of values characters
    // and 6 graph of 120 lines
    var nbVertexes = 4 * (512 + 128) + 6 * 2 * 120;
    nbVertexes *= 4;
    this._nbVertexes = 0;
    this._maxNbVertexes = 0;

    this._captionNbVertexes = 0;
    this._valuesNbVertexes = 0;
    this._graphsNbVertexes = 0;

    this.resize(nbVertexes);
};

MACROUTILS.createPrototypeObject(BufferStats, {
    getGeometry: function() {
        return this._geometry;
    },
    generateBackground: function(x, y, w, h) {
        var vertexes = this._vertexes;
        var uvs = this._uvs;

        this._nbVertexes += 4;
        var i = 0;

        vertexes[i++] = x;
        vertexes[i++] = y;
        vertexes[i++] = 0.0;

        var x1 = x + w;
        var y1 = y + h;

        vertexes[i++] = x;
        vertexes[i++] = y1;
        vertexes[i++] = 0.0;

        vertexes[i++] = x1;
        vertexes[i++] = y1;
        vertexes[i++] = 0.0;

        vertexes[i++] = x1;
        vertexes[i++] = y;
        vertexes[i++] = 0.0;

        uvs[1] = backgroundUVy;
        uvs[3] = backgroundUVy;
        uvs[5] = backgroundUVy;
        uvs[7] = backgroundUVy;
    },
    generateCharacter: function(currentPosition, w, h, ux, ux1) {
        var vertexes = this._vertexes;
        var uvs = this._uvs;
        var nbVertexes = this._nbVertexes;

        this._nbVertexes += 4;
        var i = nbVertexes * 3;

        vertexes[i++] = currentPosition[0];
        vertexes[i++] = currentPosition[1];
        vertexes[i++] = currentPosition[2];

        var x = currentPosition[0] + w;
        var y = currentPosition[1] + h;

        vertexes[i++] = currentPosition[0];
        vertexes[i++] = y;
        vertexes[i++] = currentPosition[2];

        vertexes[i++] = x;
        vertexes[i++] = y;
        vertexes[i++] = currentPosition[2];

        vertexes[i++] = x;
        vertexes[i++] = currentPosition[1];
        vertexes[i++] = currentPosition[2];

        i = nbVertexes * 2;

        uvs[i++] = ux;
        uvs[i++] = 0.0;

        uvs[i++] = ux;
        uvs[i++] = 1.0;

        uvs[i++] = ux1;
        uvs[i++] = 1.0;

        uvs[i++] = ux1;
        uvs[i++] = 0.0;
    },
    generateText: function(textCursor, text, textGenerator) {
        var size = text.length;
        if (this._nbVertexes + size * 4 >= this._maxNbVertexes) {
            this.resize(this._maxNbVertexes * 2);
            notify.info('resize buffer to ' + this._maxNbVertexes * 2);
        }
        var characterSizeUV = textGenerator._characterSizeUV;
        var characterWidth = textGenerator._characterWidth;
        var characterHeight = textGenerator._characterHeight;
        for (var i = 0; i < size; i++) {
            var characterCode = text.charCodeAt(i);
            var uvx = textGenerator.getCharacterUV(characterCode);
            this.generateCharacter(
                textCursor,
                characterWidth,
                characterHeight,
                uvx,
                uvx + characterSizeUV
            );

            textCursor[0] += characterWidth;
        }
        return size * characterWidth;
    },
    generateGraph: function(x, y, graph, height) {
        var vertexes = this._vertexes;
        var uvs = this._uvs;
        var nbVertexes = this._nbVertexes;

        var graphValues = graph._values;
        var nbGraphValues = graphValues.length;
        var graphStartIndex = graph._index;

        this._nbVertexes += nbGraphValues * 2;

        for (var i = 0; i < nbGraphValues; i++) {
            var graphIndex = (graphStartIndex + i) % nbGraphValues;
            var graphValue = graphValues[graphIndex];

            var bufferIndex = nbVertexes + i * 2;
            var vertexIndex = bufferIndex * 3;
            var uvIndex = bufferIndex * 2;

            var value = graphValue;
            if (value > 1.0) value = 1.0;
            value *= height;
            if (value < 1.0) value = 1.0;
            vertexes[vertexIndex] = x + i * 2;
            vertexes[vertexIndex + 1] = y;

            vertexes[vertexIndex + 3] = x + i * 2;
            vertexes[vertexIndex + 4] = y + value;

            uvs[uvIndex + 1] = graphUVy;
            uvs[uvIndex + 3] = graphUVy;
        }
    },
    resize: function(nbVertexes) {
        this._maxNbVertexes = nbVertexes;
        var vertexes = new Float32Array(nbVertexes * 3);
        if (this._vertexes) vertexes.set(this._vertexes);
        this._vertexes = vertexes;

        var uvs = new Float32Array(nbVertexes * 2);
        if (this._uvs) uvs.set(this._uvs);
        this._uvs = uvs;

        // it's the max number of characters displayable
        var nbCharacters = Math.ceil(nbVertexes / 4);
        this._indexes = new Uint16Array(nbCharacters * 6);
        for (var i = 0, j = 0; i < nbCharacters; i++) {
            this._indexes[j++] = i * 4 + 0;
            this._indexes[j++] = i * 4 + 1;
            this._indexes[j++] = i * 4 + 3;
            this._indexes[j++] = i * 4 + 3;
            this._indexes[j++] = i * 4 + 1;
            this._indexes[j++] = i * 4 + 2;
        }

        if (this._geometry) {
            this._geometry.getAttributes().TexCoord0.setElements(this._uvs);
            this._geometry.getAttributes().Vertex.setElements(this._vertexes);
            this._primitive.getIndices().setElements(this._indexes);
            return;
        }

        this._geometry = new Geometry();

        this._geometry.getAttributes().Vertex = new BufferArray(
            BufferArray.ARRAY_BUFFER,
            this._vertexes,
            3,
            true
        );
        this._geometry.getAttributes().TexCoord0 = new BufferArray(
            BufferArray.ARRAY_BUFFER,
            this._uvs,
            2,
            true
        );
        var indexArray = new BufferArray(BufferArray.ELEMENT_ARRAY_BUFFER, this._indexes, 1);

        // for labels and values
        this._geometry.getAttributes().TexCoord0.setUsage(this._usageHint);
        this._geometry.getAttributes().Vertex.setUsage(this._usageHint);

        var drawElement = new DrawElements(primitiveSet.TRIANGLES, indexArray);
        this._characterPrimitive = drawElement;
        this._geometry.getPrimitives().push(this._characterPrimitive);

        var drawArrays = new DrawArrays(primitiveSet.LINES, 0, 0);
        this._graphPrimitive = drawArrays;
        this._geometry.getPrimitives().push(this._graphPrimitive);
    },
    update: function() {
        var nbTotalCharacters = this._captionNbVertexes + this._valuesNbVertexes;
        this._characterPrimitive.setCount(nbTotalCharacters / 4 * 6);
        this._graphPrimitive.setCount(this._graphsNbVertexes);
        this._graphPrimitive.setFirst(nbTotalCharacters);

        this._geometry.getAttributes().Vertex.dirty();
        this._geometry.getAttributes().TexCoord0.dirty();
    },
    resetCaptions: function() {
        this._nbVertexes = 0;
        this._captionNbVertexes = 0;
    },
    resetValues: function() {
        this._nbVertexes = this._captionNbVertexes;
        this._valuesNbVertexes = 0;
        this._graphsNbVertexes = 0;
    },
    captionsEnd: function() {
        this._captionNbVertexes = this._nbVertexes;
    },
    valuesEnd: function() {
        this._valuesNbVertexes = this._nbVertexes - this._captionNbVertexes;
    },
    graphsEnd: function() {
        this._graphsNbVertexes =
            this._nbVertexes - (this._valuesNbVertexes + this._captionNbVertexes);
    }
});

module.exports = BufferStats;
