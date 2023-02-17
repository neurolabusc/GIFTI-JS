//1. Install dependencies
// npm install fflate gifti-reader-js atob pako buffer lzma-purejs bjd numjs
//2. Run tests
// node ./meshtest.js

const fs = require('fs')
const gifti = require('gifti-reader-js')
const fflate = require('fflate')
const util= require('util');

NVMesh.readGII = function (buffer, n_vert = 0) {
  let len = buffer.byteLength;
  if (len < 20) throw new Error("File too small to be GII: bytes = " + len);
  var chars = new TextDecoder("ascii").decode(buffer);
  if (chars[0].charCodeAt(0) == 31) {
    //raw GIFTI saved as .gii.gz is smaller than gz GIFTI due to base64 overhead
    var raw = fflate.decompressSync(new Uint8Array(buffer));
    buffer = raw.buffer;
    chars = new TextDecoder("ascii").decode(raw.buffer);
  }
  let pos = 0;
  function readXMLtag() {
    let isEmptyTag = true;
    let startPos = pos;
    while (isEmptyTag) {
      //while (pos < len && chars[pos] === 10) pos++; //skip blank lines
      while (pos < len && chars[pos] !== "<") pos++; //find tag start symbol: '<' e.g. "<tag>"
      startPos = pos;
      while (pos < len && chars[pos] !== ">") pos++; //find tag end symbol: '>' e.g. "<tag>"
      isEmptyTag = chars[pos - 1] == "/"; // empty tag ends "/>" e.g. "<br/>"
      if (startPos + 1 < len && chars[startPos + 1] === "/") {
        // skip end tag "</"
        pos += 1;
        isEmptyTag = true;
      }
      let endTagPos = pos;
      if (pos >= len) break;
    }
    let tagString = new TextDecoder()
      .decode(buffer.slice(startPos + 1, pos))
      .trim();
    let startTag = tagString.split(" ")[0].trim();
    //ignore declarations https://stackoverflow.com/questions/60801060/what-does-mean-in-xml
    let contentStartPos = pos;
    let contentEndPos = pos;
    let endPos = pos;
    if (chars[startPos + 1] !== "?" && chars[startPos + 1] !== "!") {
      //ignore declarations "<?" and "<!"
      let endTag = "</" + startTag + ">";
      contentEndPos = chars.indexOf(endTag, contentStartPos);
      endPos = contentEndPos + endTag.length - 1;
    }
    // <name>content</name>
    // a    b      c      d
    // a: startPos
    // b: contentStartPos
    // c: contentEndPos
    // d: endPos
    return {
      name: tagString,
      startPos: startPos,
      contentStartPos: contentStartPos,
      contentEndPos: contentEndPos,
      endPos: endPos,
    }; //, 'startTagLastPos': startTagLastPos, 'endTagFirstPos': endTagFirstPos, 'endTagLastPos': endTagLastPos];
  }
  let tag = readXMLtag();
  console.log(tag);
  if (!tag.name.startsWith("?xml")) {
    console.log("readGII: Invalid XML file");
    return null;
  }
  while (!tag.name.startsWith("GIFTI") && tag.endPos < len) {
    tag = readXMLtag();
  }
  if (
    !tag.name.startsWith("GIFTI") ||
    tag.contentStartPos == tag.contentEndPos
  ) {
    console.log("readGII: XML file does not include GIFTI tag");
    return null;
  }
  len = tag.contentEndPos; //only read contents of GIfTI tag
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
  let nvert = 0;
  //FreeSurfer versions after 20221225 disambiguate if transform has been applied
  // "./mris_convert --to-scanner" store raw vertex positions in scanner space, so transforms should be ignored.
  //  FreeSurfer versions after 20221225 report that the transform is applied by reporting:
  //   <DataSpace><![CDATA[NIFTI_XFORM_SCANNER_ANAT
  let isDataSpaceScanner = false;
  tag.endPos = tag.contentStartPos; //read the children of the 'GIFTI' tag
  let line = "";
  while (tag.endPos < len && tag.name.length > 1) {
    tag = readXMLtag();
    if (tag.name.trim() === "Data") {
      if (isVectors) continue;
      line = new TextDecoder()
        .decode(buffer.slice(tag.contentStartPos + 1, tag.contentEndPos))
        .trim();
      //Data can be on one to three lines...
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
          let datZ = base64ToUint8(line.slice());
          datBin = fflate.decompressSync(new Uint8Array(datZ));
        } else datBin = base64ToUint8(line.slice());
      } else {
        //if Buffer not defined
        if (isGzip) {
          let datZ = Buffer.from(line.slice(), "base64");
          datBin = fflate.decompressSync(new Uint8Array(datZ));
        } else datBin = Buffer.from(line.slice(), "base64");
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
    if (tag.name.trim() === "DataSpace") {
      line = new TextDecoder()
        .decode(buffer.slice(tag.contentStartPos + 1, tag.contentEndPos))
        .trim();
      if (line.includes("NIFTI_XFORM_SCANNER_ANAT")) isDataSpaceScanner = true;
    }
    if (tag.name.trim() === "MD") {
      line = new TextDecoder()
        .decode(buffer.slice(tag.contentStartPos + 1, tag.contentEndPos))
        .trim();
      if (
        line.includes("AnatomicalStructurePrimary") &&
        line.includes("CDATA[")
      ) {
        this.AnatomicalStructurePrimary =
          readBracketTag("CDATA[").toUpperCase();
      }
    }
    if (tag.name.trim() === "Name") {
      line = new TextDecoder()
        .decode(buffer.slice(tag.contentStartPos + 1, tag.contentEndPos))
        .trim();
      if (line.includes("VolGeom")) {
        //the great kludge: attempt to match GIfTI and CIfTI
        let e = -1;
        if (line.includes("VolGeomC_R")) e = 0;
        if (line.includes("VolGeomC_A")) e = 1;
        if (line.includes("VolGeomC_S")) e = 2;
        if (e < 0) continue;
        pos = tag.endPos;
        tag = readXMLtag();
        line = new TextDecoder()
          .decode(buffer.slice(tag.contentStartPos + 1, tag.contentEndPos))
          .trim();
        if (e >= 0)
          FreeSurferTranlate[e] = parseFloat(readBracketTag("CDATA["));
      }
    }
    //read DataArray properties
    if (!tag.name.startsWith("DataArray")) continue;
    line = tag.name;
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
  }

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