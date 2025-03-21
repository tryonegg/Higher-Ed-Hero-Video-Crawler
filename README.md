This will scan either a single URL or a list of URLs looking for `<video>` or `<iframe>` elements, outputting the ones found as a CSV along with related metadata.

## Features
* Attempt to click on common "Accept" or "Agree" buttons to clear them off the 'screen'.
* Look for any `<video>` or `<iframe>` element that exists on the page, and if they are in the initial viewport.
* If `<video>`s are found:
  * Log a variety of element attributes (autoplay, mute, playsinline, role, etc.).
  * Log if there are any closed caption or descriptive tracks.
  * Find all the sources for all the videos found.
    * Pull metadata on them using `ffmpeg` to probe the file and get its size, bitrate, resolution, fps, audio presence, codec, and duration.
* if `<iframe>`s are found:
  * Log the source when the element is visible and the source is not on a blocklist.
* Take a screenshot if a video or iframe is found.
* Detect if videos are playing and whether they respect reduced motion settings.
* Using [SpeedyU](https://speedyu.bravery.co/), fetch and append performance data for the site from a recent scan:
  * Includes Lighthouse scores (Performance, Accessibility, Best Practices, SEO) and total page weight.
* Save the results to a CSV file with detailed metadata.

## Installing
1. Clone/download the repo.
2. Install dependencies.
```bash
npm install
```
3. Install the browsers for Playwright.
```bash
playwright install
```
4. Ensure [FFmpeg](https://ffmpeg.org/) is installed and available in your system's PATH.
5. Create a `secrets` file containing the SpeedyU API key and URL:
  ```json
  {
    "api_key": "your_speedyu_api_key",
    "api_url": "https://speedyUurl"
  }
  ```

## Configuration

- **Viewport Sizes**:
  - Mobile: `{ width: 390, height: 800 }`
  - Desktop: `{ width: 1440, height: 900 }`

- **Timeouts**:
  - Page navigation timeout: `30 seconds`

- **Concurrency**:
  - Maximum concurrent scans: `10`

## Running
You can either run this against a single URL or a list of URLs. The results will be placed in the `output` folder.

### For a Single URL
```bash
node scan.js https://example.com
```

### For a List of URLs
1. Create a text file (e.g., `input.txt`) with each URL on one line.
2. Run:
   ```bash
   node scan.js input.txt
   ```

## Output

- **CSV File**: The scan results are saved to `output/scan_results.csv`.
- **Screenshots**: Screenshots of above-the-fold content are saved to `output/screenshots/`.
- **Error Log**: Errors are logged to `output/error.log`.

## Error Handling

- Logs errors to `output/error.log` with timestamps.
- Handles common issues like 404 errors, unresolved domains, and general navigation errors.
