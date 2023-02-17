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

GIFTI-Reader-JS has a broad range of compatibility. In contrast, NiiVue focuses on the variations of GIFTI seen in the wild. For example, NiiVue is only able to read binary data (ASCII data has no redeeming features beyond human readability: it is larger, has lower precision and is dramatically slower).


# Links

 - [MeshFormatsJS](https://github.com/neurolabusc/MeshFormatsJS) compares various mesh formats with Matlab, Python and JavaScript code.
