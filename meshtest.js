//1. Install dependencies
// npm install fflate gifti-reader-js atob pako buffer lzma-purejs bjd numjs
//2. Run tests
// node ./meshtest.js

const fs = require('fs')
const gifti = require('gifti-reader-js')
const fflate = require('fflate')
const util= require('util');


readGII = function (buffer, n_vert = 0) {
  let xmlStr = buffer.toString();
  //var DomParser = require('dom-parser');
  //var parser = new DomParser();
  //const xmlDoc = parser.parseFromString(xmlStr, "text/xml");

  // current implementation does these steps:
  // 1. check that first tag is <xml> and version attribute exists
  // 2. look for <Name...> tag and parse VolGeomC... attributes
  // 3. look for <DataSpace..> tag adn parse NIFTI_XFORM_SCANNER_ANAT
  // 4. look for <Name...> tag and parse AnatomicalStructurePrimary... attributes
  // 5. look for <DataArray...> tag and parse loads of attributes
  // n. parse base64 string in <Data> tag

  // ours should:
  // 1. check xml tag
  // 2. look for <Name...> and get attributes
  // 3. iterate through <DataArray...> tags
  // 3.1 get attributes of <DataArray>
  // 3.2 parse <Data> within <DataArray>

  let len = buffer.byteLength;
  if (len < 20) throw new Error("File too small to be GII: bytes = " + len);
  var bytes = new Uint8Array(buffer);
  let pos = 0;
  function readStrX() {
    // check if current position is a new-line character
    while (pos < len && bytes[pos] === 10) pos++;
    let startPos = pos;
    while (pos < len && bytes[pos] !== 10) pos++;
    pos++; //skip EOLN
    if (pos - startPos < 1) return "";
    return new TextDecoder().decode(buffer.slice(startPos, pos - 1)).trim();
  }
  function readStr() {
    //concatenate lines to return tag <...>
    let line = readStrX();
    if (!line.startsWith("<") || line.endsWith(">")) {
      return line;
    }
    while (pos < len && !line.endsWith(">")) line += readStrX();
    return line;
  }
  let line = readStr(); //1st line: signature 'mrtrix tracks'
  if (!line.includes("xml version")) console.log("Not a GIfTI image");
  let positions = [];
  let indices = [];
  let scalars = [];
  let isIdx = false;
  let isPts = false;
  let isVectors = false;
  let isColMajor = false;
  let Dims = [1, 1, 1];
  let FreeSurferTranlate = [0, 0, 0]; //https://gist.github.com/alexisthual/f0b2f9eb2a67b8f61798f2c138dda981
  let dataType = 0;
  let isLittleEndian = true;
  let isGzip = false;
  //let FreeSurferMatrix = [];
  let nvert = 0;
  //FreeSurfer versions after 20221225 disambiguate if transform has been applied
  // "./mris_convert --to-scanner" store raw vertex positions in scanner space, so transforms should be ignored.
  //  FreeSurfer versions after 20221225 report that the transform is applied by reporting:
  //   <DataSpace><![CDATA[NIFTI_XFORM_SCANNER_ANAT
  let isDataSpaceScanner = false;
  //let isAscii = false;
  while (pos < len) {
    line = readStr();
    if (line.startsWith("<Data>")) {
      if (isVectors) continue;
      //Data can be on one to three lines...
      if (!line.endsWith("</Data>")) line += readStrX();
      if (!line.endsWith("</Data>")) line += readStrX();
      let datBin = [];
      if (typeof Buffer === "undefined") {
        //raw.gii
        function base64ToUint8(base64) {
          var binary_string = atob(base64);
          var len = binary_string.length;
          var bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
          }
          return bytes;
        }
        if (isGzip) {
          let datZ = base64ToUint8(line.slice(6, -7));
          datBin = fflate.decompressSync(new Uint8Array(datZ));
        } else datBin = base64ToUint8(line.slice(6, -7));
      } else {
        //if Buffer not defined
        if (isGzip) {
          let datZ = Buffer.from(line.slice(6, -7), "base64");
          datBin = fflate.decompressSync(new Uint8Array(datZ));
        } else datBin = Buffer.from(line.slice(6, -7), "base64");
      }

      if (isPts) {
        if (dataType !== 16) console.log("expect positions as FLOAT32");
        positions = new Float32Array(datBin.buffer);
        if (isColMajor) {
          let tmp = positions.slice();
          let np = tmp.length / 3;
          let j = 0;
          for (var p = 0; p < np; p++)
            for (var i = 0; i < 3; i++) {
              positions[j] = tmp[i * np + p];
              j++;
            }
        } //isColMajor
      } else if (isIdx) {
        if (dataType !== 8) console.log("expect indices as INT32");
        indices = new Int32Array(datBin.buffer);
        if (isColMajor) {
          let tmp = indices.slice();
          let np = tmp.length / 3;
          let j = 0;
          for (var p = 0; p < np; p++)
            for (var i = 0; i < 3; i++) {
              indices[j] = tmp[i * np + p];
              j++;
            }
        } //isColMajor
      } else {
        //not position or indices: assume scalars NIFTI_INTENT_NONE
        nvert = Dims[0] * Dims[1] * Dims[2];
        if (n_vert !== 0) {
          if (nvert % n_vert !== 0)
            console.log(
              "Number of vertices in scalar overlay (" +
                nvert +
                ") does not match mesh (" +
                n_vert +
                ")"
            );
        }
        function Float32Concat(first, second) {
          var firstLength = first.length;
          var result = new Float32Array(firstLength + second.length);
          result.set(first);
          result.set(second, firstLength);
          return result;
        } // Float32Concat()
        let scalarsNew = [];
        if (dataType === 2) {
          let scalarsInt = new UInt8Array(datBin.buffer);
          scalarsNew = Float32Array.from(scalarsInt);
        } else if (dataType === 8) {
          let scalarsInt = new Int32Array(datBin.buffer);
          scalarsNew = Float32Array.from(scalarsInt);
        } else if (dataType === 16) {
          scalarsNew = new Float32Array(datBin.buffer);
        } else if (dataType === 32) {
          let scalarFloat = new Float64Array(datBin.buffer);
          scalarsNew = Float32Array.from(scalarFloat);
        } else {
          throw new Error(`Invalid dataType: ${dataType}`);
        }
        scalars = Float32Concat(scalars, scalarsNew);
      }
      continue;
    }
    function readBracketTag(TagName) {
      let pos = line.indexOf(TagName);
      if (pos < 0) return "";
      let spos = line.indexOf("[", pos) + 1;
      let epos = line.indexOf("]", spos);
      return line.slice(spos, epos);
    }
    if (line.startsWith("<Name") && line.includes("VolGeom")) {
      //the great kludge: attempt to match GIfTI and CIfTI
      let e = -1;
      if (line.includes("VolGeomC_R")) e = 0;
      if (line.includes("VolGeomC_A")) e = 1;
      if (line.includes("VolGeomC_S")) e = 2;
      if (!line.includes("<Value")) line = readStr();
      if (!line.includes("CDATA[")) continue;
      if (e >= 0) FreeSurferTranlate[e] = parseFloat(readBracketTag("CDATA["));
    }
    //<TransformedSpace>
    if (
      line.startsWith("<DataSpace") &&
      line.includes("NIFTI_XFORM_SCANNER_ANAT")
    ) {
      isDataSpaceScanner = true;
    }
    /*
    //in theory, matrix can store rotations, zooms, but in practice translation so redundant with VolGeomC_*
    if (line.startsWith("<MatrixData>")) {
      //yet another kludge for undocumented FreeSurfer transform
      while (pos < len && !line.endsWith("</MatrixData>"))
        line += " " + readStrX();
      line = line.replace("<MatrixData>", "");
      line = line.replace("</MatrixData>", "");
      line = line.replace("  ", " ");
      line = line.trim();
      var floats = line.split(/\s+/).map(parseFloat);
      if (floats.length != 16)
        console.log("Expected MatrixData to have 16 items: '" + line + "'");
      else {
        FreeSurferMatrix = mat4.create();
        for (var i = 0; i < 16; i++) FreeSurferMatrix[i] = floats[i];
      }
    }*/

    if (
      line.startsWith("<Name") &&
      line.includes("AnatomicalStructurePrimary")
    ) {
      //the great kludge: attempt to match GIfTI and CIfTI
      //unclear how connectome workbench reconciles multiple CIfTI structures with GIfTI mesh
      if (!line.includes("<Value")) line = readStr();
      if (!line.includes("CDATA[")) continue;
      this.AnatomicalStructurePrimary = readBracketTag("CDATA[").toUpperCase();
    }

    if (!line.startsWith("<DataArray")) continue;

    //read DataArray properties
    Dims = [1, 1, 1];
    isGzip = line.includes('Encoding="GZipBase64Binary"');
    if (line.includes('Encoding="ASCII"'))
      throw new Error("ASCII GIfTI not supported.");
    isIdx = line.includes('Intent="NIFTI_INTENT_TRIANGLE"');
    isPts = line.includes('Intent="NIFTI_INTENT_POINTSET"');
    isVectors = line.includes('Intent="NIFTI_INTENT_VECTOR"');
    isColMajor = line.includes('ArrayIndexingOrder="ColumnMajorOrder"');
    isLittleEndian = line.includes('Endian="LittleEndian"');
    if (line.includes('DataType="NIFTI_TYPE_UINT8"')) dataType = 2; //DT_UINT8
    if (line.includes('DataType="NIFTI_TYPE_INT32"')) dataType = 8; //DT_INT32
    if (line.includes('DataType="NIFTI_TYPE_FLOAT32"')) dataType = 16; //DT_FLOAT32
    if (line.includes('DataType="NIFTI_TYPE_FLOAT64"')) dataType = 32; //DT_FLOAT64

    function readNumericTag(TagName) {
      //Tag 'Dim1' will return 3 for Dim1="3"
      let pos = line.indexOf(TagName);
      if (pos < 0) return 1;
      let spos = line.indexOf('"', pos) + 1;
      let epos = line.indexOf('"', spos);
      let str = line.slice(spos, epos);
      return parseInt(str);
    }
    Dims[0] = readNumericTag("Dim0=");
    Dims[1] = readNumericTag("Dim1=");
    Dims[2] = readNumericTag("Dim2=");
  } //for each line

  if (n_vert > 0) return scalars;
  if (
    positions.length > 2 &&
    !isDataSpaceScanner &&
    (FreeSurferTranlate[0] != 0 ||
      FreeSurferTranlate[1] != 0 ||
      FreeSurferTranlate[2] != 0)
  ) {
    nvert = Math.floor(positions.length / 3);
    let i = 0;
    for (var v = 0; v < nvert; v++) {
      positions[i] += FreeSurferTranlate[0];
      i++;
      positions[i] += FreeSurferTranlate[1];
      i++;
      positions[i] += FreeSurferTranlate[2];
      i++;
    }
  } //issue416: apply FreeSurfer translation
  return {
    positions,
    indices,
    scalars,
  }; //MatrixData
}; // readGII()

async function main() {
  //const fnms = ["obj.obj", "gz.gii",  "raw.gii", "ply.ply", "gz.mz3", "raw.mz3",  "stl.stl", "zlib.jmsh", "zlib.bmsh", "raw.min.json", "raw.bmsh", "lzma.bmsh"];
  const fnms = [ "gz.gii",  "raw.gii"]
  //const fnms = ["gz.gii", "gz.mz3", "raw.mz3", "obj.obj", "stl.stl"];
  let npt = 491526; //number of points, each vertex has 3 (XYZ)
  let nidx = 983040; //number of indices: each triangle has 3
  let nrepeats = 10;
  for (let m = 0; m < 2; m++) {
    let isGiftiReaderJS = (m == 0);
    if (isGiftiReaderJS)
      console.log('Library: GiftiReaderJS')
    else
      console.log('Library: NiiVue')
    for (let f = 0; f < fnms.length; f++) {
      fnm = './meshes/'+fnms[f];
      if (!fs.existsSync(fnm)) {
        console.error("Unable to find mesh: "+fnm);
        continue;
      }
      //find file size:
      var dat = fs.readFileSync(fnm);

      //determine format based on extension
      var re = /(?:\.([^.]+))?$/;
      let ext = re.exec(fnm)[1];
      let d = Date.now()
      let points = [];
      let indices = [];
      for (let i = 0; i < nrepeats; i++) {
        if (i == 1) d = Date.now(); //ignore first run for interpretting/disk
        if (isGiftiReaderJS) {
          var data = fs.readFileSync(fnm);
          var gii = gifti.parse(data);
          points = gii.getPointsDataArray().getData();
          indices = gii.getTrianglesDataArray().getData();
        } else {
          var data = fs.readFileSync(fnm).buffer;
          let obj = readGII(data);
          points = obj.positions.slice();
          indices = obj.indices.slice();
        }

      } //for i : repeats
      let ms = Date.now() - d;
      console.log(`${fnms[f]}\tSize\t${dat.length}\tTime\t${ms}`);
      console.assert(points.length === npt, "wrong number of points");
      console.assert(indices.length === nidx, "wrong number of indices");
    } //for j
  }
}
main().then(() => console.log('Done'))