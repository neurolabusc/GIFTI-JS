# GIFTI-JS

[GIfTI](https://www.nitrc.org/projects/gifti/) is a popular neuroimaging mesh format. [GIFTI-Reader-JS](https://github.com/rii-mango/GIFTI-Reader-JS) is a popular, mature, proven and robust library for reading GIFTI. This library uses 25mb of disk space (much is tests), depends on pako (1.7mb) and sax (66kb). [NiiVue](https://github.com/niivue/niivue) introduces an experimental minimal GIFTI reading function. This function is 10kb and uses fflate (557kb). This repository compares the performance of these two libraries. It also provides a mechanism to test and extend the compatibility of the nascent NiiVue code. 

```console
git clone git@github.com:neurolabusc/GIFTI-JS.git
cd GIFTI-JS/
npm install fflate gifti-reader-js pako
node ./meshtest.js
```

Here is the performance of these two libraries:

| File    | GiftiReaderJS |  NiiVue       |
| --------| ------------- | ------------- |
| gz.gii  |          1339 |           589 |
| raw.gii |          1206 |           456 |

# Limitations

GIFTI-Reader-JS has a broad range of compatibility. In contrast, the NiiVue code is newer and has been tested on fewer interpretations of the GIfTI specification.

The GIFTI format has some inherent limitations. The specification is [poorly written](https://mathematica.stackexchange.com/questions/75517/how-to-correctly-import-data-zipped-with-the-deflate-algorithm), for example it suggests the `Base64GzipBinary` should saved streams of gzip data, where in practice both the reference datasets and existing implementations only read and write streams of deflate data (missing the header and CRC footer required by GZip). The format is [slow](https://github.com/nipy/nibabel/pull/1199#issuecomment-1443666649), with the base64 requirement yielding files that are [both require a large amount of disk space and are slow to read](https://github.com/neurolabusc/MeshFormatsJS), and some implementations creating [integer](https://github.com/nipy/nibabel/issues/792) and [float](https://github.com/nipy/nibabel/issues/1198) that are not specified in the standard and not compatible with other implementations. Despite these weaknesses, the format does provide many features useful for neuroimaging, and it has become the dominant interchange format for the field.

# Links

 - [MeshFormatsJS](https://github.com/neurolabusc/MeshFormatsJS) compares various mesh formats with Matlab, Python and JavaScript code.
