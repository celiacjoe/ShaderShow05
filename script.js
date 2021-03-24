

'use strict';


const canvas = document.getElementsByTagName('canvas')[0];
resizeCanvas();

let config = {
    DYE_RESOLUTION: 512,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: false,
  //  SUNRAYS: true,
  //  SUNRAYS_RESOLUTION: 1024,
}

function pointerPrototype () {
    this.id = -1;
    this.texcoordX = 0;
    this.texcoordY = 0;
    this.prevTexcoordX = 0;
    this.prevTexcoordY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.down = false;
    this.moved = false;
}

let pointers = [];
let splatStack = [];
pointers.push(new pointerPrototype());

const { gl, ext } = getWebGLContext(canvas);

if (isMobile()) {
    config.DYE_RESOLUTION = 512;
  //  config.SUNRAYS_RESOLUTION = 512;
}
if (!ext.supportLinearFiltering) {
  //  config.DYE_RESOLUTION = 512;
//  config.SUNRAYS_RESOLUTION = 512;

}

function getWebGLContext (canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    let halfFloat;
    let supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA;
    let formatRG;
    let formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    ga('send', 'event', isWebGL2 ? 'webgl2' : 'webgl', formatRGBA == null ? 'not supported' : 'supported');

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat,
        format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status == gl.FRAMEBUFFER_COMPLETE;
}


function isMobile () {
    return /Mobi|Android/i.test(navigator.userAgent);
}

function framebufferToTexture (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let length = target.width * target.height * 4;
    let texture = new Float32Array(length);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, texture);
    return texture;
}


class Material {
    constructor (vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }

    setKeywords (keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++)
            hash += hashCode(keywords[i]);

        let program = this.programs[hash];
        if (program == null)
        {
            let fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = createProgram(this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }

        if (program == this.activeProgram) return;

        this.uniforms = getUniforms(program);
        this.activeProgram = program;
    }

    bind () {
        gl.useProgram(this.activeProgram);
    }
}

class Program {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function createProgram (vertexShader, fragmentShader) {
    let program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.trace(gl.getProgramInfoLog(program));

    return program;
}

function getUniforms (program) {
    let uniforms = [];
    let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
        let uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
    }
    return uniforms;
}

function compileShader (type, source, keywords) {
    source = addKeywords(source, keywords);

    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.trace(gl.getShaderInfoLog(shader));

    return shader;
};

function addKeywords (source, keywords) {
    if (keywords == null) return source;
    let keywordsString = '';
    keywords.forEach(keyword => {
        keywordsString += '#define ' + keyword + '\n';
    });
    return keywordsString + source;
}

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        /*vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);*/
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float time;
    uniform vec2 resolution;
    void main () {
      vec2 uv = vUv;
        vec4 t = texture2D(uTexture,uv);
      //  vec3 h = (3.*abs(1.-2.*fract(t.y*-0.5+vec3(0.,-1./3.,1./3.)))-1.)*t.y;
      //  vec3 r1 = max(h,t.x*t.y*0.3)*t.x*2.;
        gl_FragColor = vec4(t.x,t.x,t.x,1.);
    }
`;


const splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform float time;
    uniform sampler2D uTarget;
    uniform vec2 resolution;
    uniform vec2 mouse;
    uniform vec2 prevmouse;
    float li (vec2 uv,vec2 a , vec2 b){ vec2 ua = uv-a; vec2 ba = b-a;
float h = clamp(dot(ua,ba)/dot(ba,ba),0.,1.);
return length(ua-ba*h);}
    void main () {
        vec2 uv = vUv;
        vec2 m = mouse;
    vec2 m2 = vec2(texture2D(uTarget,vec2(0.25,0.5)).a,texture2D(uTarget,vec2(0.75,0.5)).a);
    vec2 p1 = clamp(mix(m2+(m-0.5)*0.1,vec2(0.5),0.05),0.,1.);
    float fm = mix(p1.x,p1.y,step(0.5,uv.x));
    vec2 d2 = step(m,uv);
    vec2 vd3 = p1;
    vec2 fd3 = step(vd3,uv);
    vec2 d3 = mix(fd3,1.-fd3,step(vd3,m));
    float d4 = mix(d2.x,1.-d2.x,d3.x);
    float d5 = mix(d4,1.-d4,d2.y);
    float d6 = mix(d5,1.-d5,d3.y);
    //float dp = smoothstep(0.003,0.001,li(uv,m+clamp((m2-0.5)*-1.,-0.2,0.2),m));
    //float d7 = mix(d6,1.-d6,dp);
    vec2 tb2 = texture2D(uTarget,uv+(uv-0.5)*0.03).xy;
    float ft = fract(time*3.*mix(1.,2.,step(0.25,fract(time*1.5))))*min(distance(m,prevmouse)*20.,1.);
    float tb3 = sin(tb2.x*(ft*20.));
    float d8 = max(mix(d6,0.,tb3),mix(1.-d6,0.,tb3)*0.2);
  //float d9 = max(1.-d6,tb2.y*0.9);
        gl_FragColor = vec4(smoothstep(0.,1.,d8),0.,0.,fm);

    }
`);

const blit = (() => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (target, clear = false) => {
        if (target == null)
        {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        else
        {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }

        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

function CHECK_FRAMEBUFFER_STATUS () {
    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE)
        console.trace("Framebuffer error: " + status);
}

let dye;
//let sunrays;

//const sunraysProgram         = new Program(baseVertexShader, sunraysShader);
const splatProgram           = new Program(baseVertexShader, splatShader);


const displayMaterial = new Material(baseVertexShader, displayShaderSource);

function initFramebuffers () {

    let dyeRes = getResolution(config.DYE_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba    = ext.formatRGBA;
    const rg      = ext.formatRG;
    const r       = ext.formatR;
    //const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

  //  if (dye == null)
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType,  gl.LINEAR);
  //  else
      //  dye = resizeDoubleFBO(dye,canvas.width*0.5, canvas.height*0.5, rgba.internalFormat, rgba.format, texType, filtering);


    //initSunraysFramebuffers();
}


function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let texelSizeX = 1.0 / w;
    let texelSizeY = 1.0 / h;

    return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap () {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function updateKeywords () {
    let displayKeywords = [];
  //  if (config.SUNRAYS) displayKeywords.push("SUNRAYS");
    displayMaterial.setKeywords(displayKeywords);
}

updateKeywords();
initFramebuffers();

let lastUpdateTime = Date.now();
update();

function update () {
  //  const dt = calcDeltaTime();
    if (resizeCanvas())
        initFramebuffers();
//    updateColors(dt);
    //applyInputs();
  /*  if (!config.PAUSED)
        step(dt);*/
        splat();
    render(null);
    requestAnimationFrame(update);
}

function calcDeltaTime () {
    let now = Date.now();
    let dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas () {
    let width = scaleByPixelRatio(canvas.clientWidth);
    let height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }
    return false;
}

/*function applyInputs () {

  //  pointers.forEach(p => {splatPointer();});
  //splatPointer( pointers[0]);
  splat();
}*/

function render (target) {

      //  applySunrays(dye.read, dye.write, sunrays);
    drawDisplay(target);
}

function drawDisplay (target) {
    let width = target == null ? gl.drawingBufferWidth : target.width;
    let height = target == null ? gl.drawingBufferHeight : target.height;

    displayMaterial.bind();
  gl.uniform1f(displayMaterial.uniforms.time, performance.now() / 1000);
  gl.uniform2f(displayMaterial.uniforms.resolution, canvas.width , canvas.height);

    blit(target);
}

/*function applySunrays (source, mask, destination) {
    gl.disable(gl.BLEND);
    sunraysProgram.bind();
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT);
    blit(destination);
}*/

/*function splatPointer (pointer) {

    splat(pointers[0].texcoordX, pointers[0].texcoordY);
}*/

function splat () {
  let dyeRes = getResolution(config.DYE_RESOLUTION);
    splatProgram.bind();
    gl.uniform1f(splatProgram.uniforms.time, performance.now() / 1000);
    gl.uniform2f(splatProgram.uniforms.resolution, dyeRes.width , dyeRes.height);
    gl.uniform2f(splatProgram.uniforms.mouse, pointers[0].texcoordX, pointers[0].texcoordY);
    gl.uniform2f(splatProgram.uniforms.prevmouse, pointers[0].prevTexcoordX, pointers[0].prevTexcoordY);
    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    blit(dye.write);
    dye.swap();
}

canvas.addEventListener('mousedown', e => {
  //navigator.vibrate(200);
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    //let pointer = pointers.find(p => p.id == -1);
    let pointer = pointers[0];
    if (pointer == null)
        pointer = new pointerPrototype();
    updatePointerDownData(pointer, -1, posX, posY);
});

canvas.addEventListener('mousemove', e => {
    let pointer = pointers[0];
    if (!pointer.down) return;
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    updatePointerMoveData(pointer, posX, posY);
});

window.addEventListener('mouseup', () => {
 navigator.vibrate(200);
    updatePointerUpData(pointers[0]);
});

canvas.addEventListener('touchstart', e => {
  navigator.vibrate(100);
    e.preventDefault();
    const touches = e.targetTouches;
    while (touches.length >= pointers.length)
        pointers.push(new pointerPrototype());
  //  for (let i = 0; i < touches.length; i++) {
        let posX = scaleByPixelRatio(touches[0].pageX);
        let posY = scaleByPixelRatio(touches[0].pageY);
        //updatePointerDownData(pointers[i + 1], touches[i].identifier, posX, posY);
        updatePointerDownData(pointers[0], touches[0].identifier, posX, posY);
  //  }
});

canvas.addEventListener('touchmove', e => {
  //navigator.vibrate(10);
    e.preventDefault();
    const touches = e.targetTouches;
  //  for (let i = 0; i < touches.length; i++) {
        //let pointer = pointers[i + 1];
        let pointer = pointers[0];
        //if (!pointer.down) continue;
        let posX = scaleByPixelRatio(touches[0].pageX);
        let posY = scaleByPixelRatio(touches[0].pageY);
        updatePointerMoveData(pointer, posX, posY);
  //  }
}, false);

window.addEventListener('touchend', e => {
  navigator.vibrate(100);
    const touches = e.changedTouches;
  //  for (let i = 0; i < touches.length; i++)
  //  {
        let pointer = pointers.find(p => p.id == touches[0].identifier);
        //if (pointer == null) continue;
        updatePointerUpData(pointer);
  //  }
});


function updatePointerDownData (pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
}

function updatePointerMoveData (pointer, posX, posY) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
}

function updatePointerUpData (pointer) {
    pointer.down = false;
}

function correctDeltaX (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio < 1) delta *= aspectRatio;
    return delta;
}

function correctDeltaY (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) delta /= aspectRatio;
    return delta;
}

/*function wrap (value, min, max) {
    let range = max - min;
    if (range == 0) return min;
    return (value - min) % range + min;
}*/

function getResolution (resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        aspectRatio = 1.0 / aspectRatio;

    let min = Math.round(resolution);
    let max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

function getTextureScale (texture, width, height) {
    return {
        x: width / texture.width,
        y: height / texture.height
    };
}

function scaleByPixelRatio (input) {
    let pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function hashCode (s) {
    if (s.length == 0) return 0;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};
function lerp (start, end, amt){
  return (1-amt)*start+amt*end
}
function fract(tt) { return tt - Math.floor(tt); }
/*function sharkFin(x) {
  if (x < 0) return 0;
  x = x * 2 % 2 + 0.05;
  if (x < 1) {
    return  1 + Math.log(x) / 4;
  }
  return Math.pow(-x, -2);
}*/
window.audiocontext = window.AudioContext || webkitAudioContext;
var context = new audiocontext();
/*var count = 128;
var sharkFinValues = new Array(count);
for (var i = 0; i < count; i++) {
  sharkFinValues[i] = sharkFin(i/count);
}*/
//var real = new Float32Array([0.2,0.6,0.7,0.1,0.5,0.6,0.1,0.9,0.1,0.5,0.6,0.4,0.8,0.9,0.2,0.4,0.6,0.5,0.9,0.7,0.9,0.4,0.2,0.3,0.2]);
//var imag = new Float32Array([0.8,0.3,0.5,0.9,0.4,0.7,0.1,0.6,0.6,0.4,0.5,0.6,0.4,0.7,0.8,0.6,0.4,0.3,0.2,0.1,0.2,0.3,0.5,0.6,0.7]);
//var ft = new DFT(sharkFinValues.length);
//ft.forward(sharkFinValues);
//var real = new Float32Array([0,-0.4,0.4,-1,1,-1,0.3,0.7,0.6,-0.5,-0.9,0.8]);

//ar imag = new Float32Array([0.5,0.8,0.3,-0.3,0.2,-0.5,-0.6,0.1,-0.3,0.5,0.7,0.9]);

    //imag[i] =Math.pow(-1, i + 1) * (2 / (i * Math.PI));//sawtooth
    //imag[i] =(2 / (i * Math.PI)) * (1 - Math.pow(-1, i));//square
//  imag[i] =  (8 * Math.sin((i * Math.PI) / 2)) / Math.pow(Math.PI * i, 2);//triangle

/*var imag = Array.from({ length: 64 }, (_, n) => (
  n === 1 ?
  1 :
  0
));
var real = imag.map(() => 0);*/


//
var osc = context.createOscillator();

//osc.type = 'sawtooth';
osc
var vol = context.createGain();
//var dt = calcDeltaTime();

/*var bufferSize = 4096;
var brownNoise = (function() {
    var lastOut = 0.0;
    var node =context.createScriptProcessor(bufferSize, 1, 1);
    node.onaudioprocess = function(e) {
        var output = e.outputBuffer.getChannelData(0);
        for (var i = 0; i < bufferSize; i++) {
            var white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5; // (roughly) compensate for gain
        }
    }
    return node;
})();*/

setInterval(sons, 1)

function sons() {
  var time = context.currentTime;
  var px = pointers[0].texcoordX;
  var pvx = pointers[0].prevTexcoordX;
  var py = pointers[0].texcoordY;
  var pvy = pointers[0].prevTexcoordY;

      var vf1 = fract(time*1.5);
      var v0 = 1.;
      if(vf1>0.25) {
        v0 =2.;
      }
      var a1 = fract(time*3.*v0);
      var f1 = (1.-Math.pow(fract(a1),0.8));
  var count =8 ; // The more coefficients you use, the better the approximation
  var real = new Float32Array(count);
  var imag = new Float32Array(count);
   var f2 = Math.pow(Math.sin(f1),px*0.6);
   var f3 = Math.pow(Math.sin(f1),4.*py);
  //real[0] = 0.5;
  for (var i = 1; i < count; i++) { // note i starts at 1
  imag[i] =  Math.sin(i*f2+f3) ;
}
  var wave = context.createPeriodicWave(real, imag);
  osc.setPeriodicWave(wave);

    //var f1 = (1.-Math.pow(fract(a1),0.5));
    //osc.frequency.value = ((pointers[0].texcoordY-pvx)*300.);
    //vec2 p1 = clamp(mix(m2+(m-0.5)*0.1,vec2(0.5),0.05),0.,1.);
    //osc.frequency.value = Math.min(Math.abs((py-lerp(pvy,py,0.7))*10000.),300.);
    //  console.log( Math.min(((py-lerp(pvy,py,0.5))*6000.),100.));
    //var fa = lerp(Math.pow(Math.hypot(px-pvx,py-py),0.1),0.,dt);
    var fa = Math.min(Math.hypot(px-pvx,py-pvy)*100.,3.);
    osc.frequency.value =fa*20.*f1;
    //osc.frequency.value = (100.)*f1;
    vol.gain.value =fa*f1;
    //vol.gain.exponentialRampToValueAtTime(0.9,time+1.);
}
//brownNoise.connect(vol).connect(context.destination);
osc.connect(vol).connect(context.destination);
    osc.start();
