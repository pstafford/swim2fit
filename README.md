# Swim2Fit

Turns a swim session PDF, or typed sets, into a Garmin FIT workout file. It is a static web page: PDFs are read in the browser and nothing is uploaded.

## Using it

Open the page, choose one or more session PDFs, check the steps and any warnings, then download the `.fit` file. To load it, connect the watch by USB and copy the file to `GARMIN/NewFiles`.

## Developing

```
npm install
npm test
python3 -m http.server   # then open http://localhost:8000
```

There is no build step. `src/parser.js` reads the notation, `src/extract.js` finds the sets in a PDF, and `src/fit.js` writes the file. `vendor/` holds pdf.js (Apache-2.0).

Tests check the output with Garmin's official decoder (`@garmin/fitsdk`, a dev dependency only). Real sessions go in `test/private/`, which git ignores, and `test/samples.test.js` runs them if present.

## Hosting

Push to GitHub and enable Pages for the `main` branch, root folder.
