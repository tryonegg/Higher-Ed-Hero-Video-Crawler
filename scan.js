const fs = require( 'fs' );
const os = require( 'os' );
const { chromium } = require( 'playwright' );
const path = require( 'path' );
const { execSync } = require( 'child_process' );
const { program } = require( 'commander' );
const cliProgress = require( 'cli-progress' ); // Replace progress with cli-progress
const { URL } = require( 'url' );

// Detect OS and set Chrome's executable path
// We need this as the chromium does not have all the media codecs installed
let executablePath;
if ( os.platform() === 'darwin' ) { // macOS
	executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
} else if ( os.platform() === 'win32' ) { // Windows
	executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
} else { // Linux
	executablePath = '/usr/bin/google-chrome';
}

// List of iframe sources to ignore
const ignore_iframe_src = [
	'googletagmanager',
	'doubleclick',
	'adsrvr',
	'facebook',
	'force.com',
	'google.com',
	'admithub',
	'hubspot',
	'WixWorker',
	'syndicatedsearch',
	'cookiebot',
	'sharethis',
	'unibuddy',
];

// Selectors for common cookie banners
const cookie_selectors = [
	'button:has-text("Accept")',
	'button:has-text("Agree")',
	'button:has-text("Allow")',
	'button:has-text("OK")',
	'[aria-label*="cookies"]',
	'[id*="cookie"] button',
	'button[class*="agree-button"]',
	'button[aria-label*="cookie"]',
	'button[id*="cookie"]', // Any button with "cookie" in the id
	'button[class*="cookie"]', // Any button with "cookie" in the class name
	'[class*="cookie"] [role="button"]' // Role-based button inside cookie-related elements
];

// Output headers
const headers = {
	"URL": '',
	"General Error": false,
	"Unresolved": false,
	"Error - 404": false,
	"Redirected To": '',
	"Above Fold - Mobile": false,
	"Above Fold - Desktop": false,
	"Iframe Source": '',
	"Video Source": '',
	"Self-Hosted": false,
	"CDN Domain": '',
	"Playing": '',
	"CC or Descriptive Track Found": '',
	'Mobile and Desktop Difference Src': '',
	"Width": '',
	"Height": '',
	"Bitrate": '',
	"Audio Present": '',
	"Codec": '',
	"Duration": '',
	"Framerate": '',
	"File Size": '',
	"Loop": '',
	"Muted": '',
	"Preload": '',
	"Autoplay": '',
	"Poster": '',
	"Controls": '',
	"Playsinline": '',
	"Number of Video Sources": '',
	"Controlslist": '',
	"Crossorigin": '',
	'Disable Picture-in-Picture': '',
	'Disable Remote Playback': '',
	'Role': '',
	"SpeedyU - Link": '',
	"SpeedyU - Name": '',
	"SpeedyU - City": '',
	"SpeedyU - State": '',
	"SpeedyU - Country": '',
	"SpeedyU - Type": '',
	"SpeedyU - Score": '',
	"SpeedyU - Rank": '',
	'LH - Performance': '',
	'LH - Accessibility': '',
	'LH - BestPractices': '',
	'LH - SEO': '',
	'LH - Total Weight': '',
	'Playing - Low Motion': '',
	// 'Playing - DataSaver': '',
	"Iframe Sources - Mobile": '',
	"Iframe Sources - Desktop": '',
	"Video Data - Mobile": '',
	"Video Data - Desktop": '',
};

// Load the SpeedyU Token and API URL from an external JSON file
const secretsPath = path.resolve( __dirname, 'secrets' );
const secrets = JSON.parse( fs.readFileSync( secretsPath, 'utf-8' ) );
const SpeedyU_Token = secrets.api_key;
const SpeedyU_API_URL = secrets.api_url;

// Viewport sizes
const MOBILE_VIEWPORT = { width: 390, height: 800 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// max sites to scan at one time
const MAX_CONCURRENT = 10;

// Configurable timeout for page navigation
const PAGE_TIMEOUT = 30000;

// Output Folder
const OUTPUT_DIR = 'output';

// CSV output
const CSV_FILE = `${ OUTPUT_DIR }/scan_results.csv`;

// Ensure the output directory exists
fs.mkdirSync( OUTPUT_DIR, { recursive: true } );

// Initialize individual progress bars
const individualProgressBars = new cliProgress.MultiBar( {
	format: '[ ' + '{bar}'  + ' ] {percentage}% | {value}/{total} | Duration: {duration_formatted} | ETA: {eta_formatted} | {status}',
	clearOnComplete: true,
	hideCursor: true,
	autopadding: true,
}, cliProgress.Presets.shades_classic );

const progressbars = [];
/**
 * Updates the progress bar for a specific task.
 * @param {Object} progressBar - The progress bar instance.
 * @param {string} status - The current status text.
 */
function updateProgressBar( progressBar, status, finished = false ) {
	if ( !progressbars[ progressBar ] ) {
		progressbars[ progressBar ] = individualProgressBars.create( 16, 0, { task: `Scanning`, status: 'Starting...' } );
	}
	progressbars[ progressBar ].increment();
	progressbars[ progressBar ].update( { status } );
	if ( finished ) {
		progressbars[ progressBar ].stop();
	}
}

function startProgressBar( progressBar, status ) {
	if ( !progressbars[ progressBar ] ) {
		progressbars[ progressBar ] = individualProgressBars.create( 16, 0, { task: `Scanning`, status: 'Starting...' } );
	}
	progressbars[ progressBar ].start( 16, 0, { status } );
	progressbars[ progressBar ].increment();
}

// Initialize Progress bar
// const progressBar = new cliProgress.SingleBar( {
// 	format: 'Scanning [{bar}] {percentage}% | ETA: {eta_formatted} | Duration: {duration_formatted} | {value}/{total}'
// }, cliProgress.Presets.shades_classic );

// const overallProgressBar = new cliProgress.SingleBar( {
// 	format: 'Scanning [{bar}] {percentage}% | ETA: {eta_formatted} | Duration: {duration_formatted} | {value}/{total}'
// }, cliProgress.Presets.shades_classic );
let overallProgressBar = 0;

/**
 * Sanitizes a URL to create a valid filename.
 * @param {string} url - The URL to sanitize.
 * @returns {string} A sanitized string suitable for use as a filename.
 */
function sanitizeUrlForFilename( url ) {
	return url.replace( /https?:\/\//, '' ).replace( /\//g, '_' );
}

/**
 * Uses ffprobe to retrieve metadata about a video file.
 * @param {string} videoUrl - The URL or path of the video file.
 * @returns {Object} An object containing video metadata or an error object if retrieval fails.
 */
function getVideoMetadata( videoUrl ) {
	let cmd = [
		'ffprobe',
		'-v', 'error',
		'-show_entries',
		'format=size,duration,bit_rate:stream=codec_name,codec_type,width,height,r_frame_rate,sample_fmt,channels',
		'-of', 'json',
		'"', videoUrl, '"'
	].join( ' ' );

	try {
		// Run the ffprobe command and capture its output
		let result = execSync( cmd, { encoding: 'utf-8', stdio: [ 'ignore', 'pipe', 'ignore' ] } ); // Suppress stderr
		let data = JSON.parse( result );

		// Extract the format information
		let videoFormatInfo = data.format || {};
		let size = videoFormatInfo.size;
		let bitRate = parseInt( videoFormatInfo.bit_rate || 0, 10 ); // Keep in bytes
		let duration = videoFormatInfo.duration || null;

		// Initialize variables to store first video track info and audio presence
		let videoTrack = null;
		let hasAudio = false;
		let frameRate = null;
		let codec = null;
		let width = null;
		let height = null;

		// Check each stream for type and extract needed details from the first video stream found
		let streams = data.streams || [];
		for ( let stream of streams ) {
			let codecType = stream.codec_type;

			if ( codecType === "video" && !videoTrack ) {
				videoTrack = true;
				let [ frameRateNumerator, frameRateDenominator ] = stream.r_frame_rate.split( '/' ).map( Number );
				frameRate = Math.round( frameRateNumerator / frameRateDenominator * 100 ) / 100;
				width = stream.width;
				height = stream.height;
				codec = stream.codec_name;
			}

			if ( codecType === "audio" ) {
				hasAudio = true;
			}
		}

		// Return both video track metadata and audio presence
		return {
			// url: videoUrl,
			duration,
			has_audio: hasAudio,
			bit_rate: bitRate,
			size,
			frame_rate: frameRate,
			width,
			height,
			codec,
		};

	} catch ( e ) {
		return {
			url: videoUrl,
			error: true,
		};
	}
}

/**
 * Reads a text file containing URLs, sanitizes them, and removes duplicates.
 * @param {string} filepath - The path to the file containing URLs.
 * @returns {Array<string>} An array of sanitized URLs.
 * @throws Will throw an error if the file does not exist.
 */
function getUrlsFromFile( filepath ) {
	try {
		if ( !fs.existsSync( filepath ) ) {
			throw new Error( `File not found: ${ filepath }` );
		}
		let lines = fs.readFileSync( filepath, 'utf-8' ).split( '\n' ).filter( Boolean );
		let websites = new Set();
		lines.forEach( line => {
			let sanitizedUrl = line.trim().replace( /\/$/, '' );
			websites.add( sanitizedUrl );
		} );
		// console.log( "Sanitized File Size:", websites.size );
		return Array.from( websites );
	} catch ( e ) {
		logErrorToFile( e.message );
		process.exit( 1 );
	}
}

/**
 * Creates a blank site object with initialized headers.
 * @param {string} url - The URL of the site.
 * @returns {Object} A blank site object with initialized headers.
 */
function getBlankSite( url ) {
	let site = structuredClone( headers );
	site[ 'URL' ] = url;
	return site;
}

/**
 * Initializes a CSV file with the specified filename and writes the headers.
 * @param {string} filename - The name of the CSV file to create.
 */
function initializeCsv( filename ) {
	let csvHeaders = Object.keys( headers ).join( ',' );
	fs.writeFileSync( filename, `${ csvHeaders }\n` );
}

/**
 * Appends a row of JSON data to the CSV file.
 * @param {Object} data - The data object to save to the CSV file.
 */
function saveToCSV( data ) {
	let encodedData = Object.values( data ).map( value => {
		if ( value === null ) {
			return ''; // Replace null with an empty string
		}
		if ( Array.isArray( value ) || typeof value === 'object' ) {
			// return JSON.stringify(value); // Encode arrays or objects as JSON strings
			return `"` + JSON.stringify( value ).replace( /"/g, "'" ) + `"`;
		}
		return value; // Keep other values as is
	} );
	fs.appendFileSync( CSV_FILE, encodedData.join( "," ) + "\n" );
}

/**
 * Checks if an element is visible within the initial viewport height (above the fold).
 * @param {Object} element - The element to check.
 * @param {number} viewportHeight - The height of the viewport.
 * @returns {Promise<boolean>} True if the element is above the fold, otherwise false.
 */
async function isAboveTheFold( element, viewportHeight ) {
	let boundingBox = await element.boundingBox();
	return boundingBox && boundingBox.y <= viewportHeight;
}

// Retrieves attributes of a video element from the page.
/**
 * Retrieves various attributes of a video element on a web page.
 * @param {ElementHandle} videoElement - The video element handle to extract attributes from.
 * @param {Page} page - The Playwright page instance where the video element resides.
 * @returns {Promise<Object>} A promise that resolves to an object containing the video attributes.
 */
async function get_video_attributes( videoElement, page ) {
	return await page.evaluate( video => {
		let poster = video.poster;
		if ( poster && !poster.startsWith( "http" ) ) {
			poster = page.url().replace( /\/$/, '' ) + '/' + poster.replace( /^\//, '' );
		}
		return {
			'Video Source': video.currentSrc,
			Autoplay: video.autoplay,
			Controls: video.controls,
			Controlslist: video.controlslist,
			Crossorigin: video.crossorigin,
			'Disable Picture-in-Picture': video.disablepictureinpicture,
			'Disable Remote Playback': video.disableremoteplayback,
			Playsinline: video.playsinline,
			Preload: video.preload,
			Muted: video.muted,
			Loop: video.loop,
			Poster: poster,
			Role: video.role,
		};
	}, videoElement );
}

/**
 * Resolves a relative URL to an absolute URL based on the base URL.
 * @param {string} relativeUrl - The relative URL to resolve.
 * @param {string} baseUrl - The base URL of the page.
 * @returns {string} The resolved absolute URL.
 */
function resolveUrl( relativeUrl, baseUrl ) {
	if ( !relativeUrl.startsWith( 'http://' ) && !relativeUrl.startsWith( 'https://' ) ) {
		return baseUrl.replace( /\/$/, '' ) + '/' + relativeUrl.replace( /^\//, '' );
	}
	return relativeUrl;
}

/**
 * Finds all the sources for a video element.
 * @param {ElementHandle} video - A video element to check.
 * @param {string} url - The base URL of the page.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of video source URLs.
 */
async function get_video_sources( video, url ) {
	let sources = [];

	// Get the src attribute from the video tag
	let sourceSrc = await video.getAttribute( 'src' );
	if ( sourceSrc ) {
		sources.push( resolveUrl( sourceSrc, url ) );
	}

	// Get any <source> elements inside the video tag
	let sourceElements = await video.$$( 'source' );
	if ( sourceElements ) {
		for ( let source of sourceElements ) {
			let sourceSrc = await source.getAttribute( 'src' );
			if ( sourceSrc ) {
				sources.push( resolveUrl( sourceSrc, url ) );
			}
		}
	}

	return sources;
}

/**
 * Finds all the tracks for a video element.
 * @param {ElementHandle} video - A video element to check.
 * @param {string} url - The base URL of the page.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of track objects.
 */
async function get_video_tracks( video, url ) {
	let tracks = [];

	// Get any <track> elements inside the video tag
	let foundTracks = await video.$$( 'track' );
	if ( foundTracks ) {
		for ( let track of foundTracks ) {
			let sourceSrc = await track.getAttribute( 'src' );
			tracks.push( {
				default: await track.getAttribute( 'default' ),
				kind: await track.getAttribute( 'kind' ),
				label: await track.getAttribute( 'label' ),
				src: sourceSrc ? resolveUrl( sourceSrc, url ) : null,
				srclang: await track.getAttribute( 'srclang' ),
			} );
		}
	}

	return tracks;
}

/**
 * Finds and retrieves information about video elements on a web page.
 * @param {Page} page - The Playwright page instance.
 * @param {Object} viewport - The viewport dimensions.
 * @param {string} url - The base URL of the page.
 * @returns {Promise<Object|boolean>} A promise that resolves to video data or false if no videos are found.
 */
async function get_video( page, viewport, url ) {
	// find all video elements
	let inInitialViewport = false;
	let videoisPlaying = false;
	let returnedSrc = [];
	let returnedVideo = false;

	let Videos = await page.$$( 'video' );

	if ( Videos.length > 0 ) {
		for ( let video of Videos ) {

			// Test if this video is above the fold
			inInitialViewport = await isAboveTheFold( video, viewport.height )

			// is this video playing
			let isPlaying = await video.evaluate( v =>
				!v.paused && !v.ended && v.readyState > 2
			);

			// video is playing
			if ( isPlaying ) {
				videoisPlaying = true;
				returnedSrc.push( await video.evaluate( v => v.currentSrc || v.src ) );

				// if a video was found that was above the fold and playing, stop and return that one
				if ( inInitialViewport ) {
					returnedVideo = video
					break;
				}
			}

			// find the video sources
			returnedSrc = await get_video_sources( video, url );

			// if the video was not playing but is in the initial viewport stop and return it. 
			if ( inInitialViewport ) {
				returnedVideo = video
				break;
			}
			returnedVideo = video
		}
	}

	if ( returnedSrc.length > 0 ) {
		isSelfHosted = returnedSrc.every( src => {
			try {
				let srcUrl = new URL( src );
				let pageUrl = new URL( url );
				return srcUrl.hostname === pageUrl.hostname;
			} catch ( e ) {
				return false; // If URL parsing fails, assume it's not self-hosted
			}
		} );
		let cdnDomain;
		if ( !isSelfHosted ) {
			try {
				let srcUrl = new URL( returnedSrc[ 0 ] );
				let hostnameParts = srcUrl.hostname.split( '.' );
				if ( hostnameParts.length > 2 ) {
					cdnDomain = hostnameParts.slice( -2 ).join( '.' );
				} else {
					cdnDomain = srcUrl.hostname;
				}
			} catch ( e ) {
				cdnDomain = '';
			}
		}

		let srcMetadata = {};
		for ( let videoSrc of returnedSrc ) {
			srcMetadata[ videoSrc ] = getVideoMetadata( videoSrc );
		}

		return {
			src: returnedSrc,
			srcMetadata: srcMetadata, //returnedSrc.map( videoSrc => getVideoMetadata( videoSrc ) ),
			attrs: await get_video_attributes( returnedVideo, page ),
			isInInitialViewport: inInitialViewport,
			tracks: await get_video_tracks( returnedVideo, url ),
			'Self-hosted': isSelfHosted,
			'CDN Domain': cdnDomain,
			playing: videoisPlaying,
		};
	} else {
		return false;
	}
}

/**
 * Finds and retrieves information about iframe elements on a web page.
 * @param {Page} page - The Playwright page instance.
 * @param {Object} viewport - The viewport dimensions.
 * @returns {Promise<Array<string>|string>} A promise that resolves to an array of iframe source URLs or an empty string if none are found.
 */
async function get_iframes( page, viewport ) {
	let returnedIframes = [];
	let iframes = await page.$$( 'iframe' );

	if ( iframes.length > 0 ) {
		for ( let iframe of iframes ) {
			let iframeSrc = await iframe.getAttribute( 'src' );
			if ( iframeSrc && iframeSrc.startsWith( '//' ) ) {
				iframeSrc = 'https://' + iframeSrc.replace( /^\/\//, '' );
			}

			let iframeBox = await iframe.boundingBox();

			// reject any iframes that are on 0 px or on the block list
			if (
				iframeSrc && iframeBox && (
					ignore_iframe_src.some( substring => iframeSrc.includes( substring ) )
					|| ( iframeBox.width == 0 || iframeBox.height == 0 )
				)
			) {
				continue;
			}

			if ( await isAboveTheFold( iframe, viewport.height ) ) {
				returnedIframes.push( iframeSrc );
			}
		}
		return ( returnedIframes.length > 0 ) ? returnedIframes : '';
	}
	return '';
}

/**
 * Checks if a given element is visible in the DOM.
 *
 * This function determines visibility by checking if the element exists,
 * has a bounding box, and is displayed (i.e., has dimensions or visible client rects).
 *
 * @param {import('puppeteer').ElementHandle} element - The element to check for visibility.
 * @returns {Promise<boolean>} A promise that resolves to `true` if the element is visible, otherwise `false`.
 */
async function isVisible( element ) {
	if ( !element ) return false; // Element does not exist

	let box = await element.boundingBox();
	if ( !box ) return false; // Element is not rendered

	let isDisplayed = await element.evaluate( node => {
		return !!( node.offsetWidth || node.offsetHeight || node.getClientRects().length );
	} );

	return isDisplayed;
}


/**
 * Opens a web page in a new browser context and optionally modifies it.
 * @param {string} url - The URL of the web page to open.
 * @param {Object} browser - The Playwright browser instance.
 * @param {Object} [options={}] - Options for the browser context (e.g., viewport, reduced motion).
 * @param {Function|null} [modifyPage=null] - A function to modify the page after it loads.
 * @returns {Promise<Object>} A promise that resolves to an object containing the page, context, final URL, and any errors.
 * @throws Will throw an error if the page fails to load or the browser instance is not provided.
 */
async function getWebPage(url, browser, options = {}, modifyPage = null) {
	return new Promise(async (resolve, reject) => {
        if (!url) {
            return reject(new Error('URL is required'));
        }
        
        if (!browser) {
            return reject(new Error('Browser instance is required'));
        }
        
        const context = await browser.newContext(options);
        const page = await context.newPage();
        
        try {
            const response = await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
            if (!response) {
                return reject(new Error('Failed to load page'));
            }
            
            if (response.status() === 404) {
                return reject(new Error(`Page not found (404): ${url}`));
            }
            
            if (modifyPage && typeof modifyPage === 'function') {
                await modifyPage(page);
            }

			// Wait for 2 seconds to allow videos to start playing
			await page.waitForTimeout( 2000 );		
			            
            resolve({ page, context, url: page.url(), error: null });
        } catch (error) {
			// Ensure the context is closed if an error occurs
			if ( context ) {
				await context.close();
			}
			reject( error );	        
		}
    });
}

/**
 * Fetches SpeedyU Lighthouse data for a given URL.
 * @param {string} url - The URL to fetch data for.
 * @returns {Promise<Object|null>} A promise that resolves to the SpeedyU data object or null if no data is found.
 * @throws Will log an error if the API request fails or returns a non-200 status code.
 */
async function fetchSpeedyuLighthouseData( url ) {
	// Fetch the lighthouse data for a site from SpeedyU
	let apiUrl = `${ SpeedyU_API_URL }?where=(Url,eq,${ url })~or(Url,eq,${ url }/)&fields=Name,CurrentTotal,Rank,City,State,Country,Control,LighthousePerformance,LighthouseAccessibility,LighthouseBestPractices,LighthouseSeo,LighthouseTotalByteWeight`;
	let headers = { 'xc-token': SpeedyU_Token };

	try {
		let response = await fetch( apiUrl, { headers } );
		if ( response.ok ) {
			let data = await response.json();
			return data.list && data.list[ 0 ] ? data.list[ 0 ] : null;
		} else {
			logErrorToFile( `Error: Received status code ${ response.status } from SpeedyU API for URL: ${ url }` );
			return null;
		}
	} catch ( e ) {
		logErrorToFile( `Error fetching SpeedyU data for URL: ${ url } - ${ e.message }` );
		return null;
	}
}

/**
 * Scans a website for video elements and captures relevant information. Saves the data to the CSV.
 * @param {string} url - The URL of the website to scan.
 * @param {number} index - The index number of the scanner (used for progress tracking).
 * @returns {Promise<void>} A promise that resolves when the scan is complete.
 * @throws Will log errors for specific issues encountered during the scan.
 */
async function scanWebsite( url, index ) {
	startProgressBar( index, url + " - " + "Start" );
	// console.log( "Scanning", url );

	// get a blank template to return
	let site = getBlankSite( url );

	// Create a progress bar for this site
	let browser;
	try {
		updateProgressBar( index, url + " - " + 'Open Browser' );
		// get a new browser
		browser = await chromium.launch( {
			headless: true,
			executablePath, // Use system-installed Chrome
		} );
		activeBrowsers.push( browser ); // Track the browser instance
		// browser = await firefox.launch( );

		// Run Mobile and Desktop checks concurrently
		let mobilepage, desktoppage;
		// await Promise.allSettled( [
		// ( async () => {
		try {
			updateProgressBar( index, url + " - " + 'Mobile scan' );
			try {
				mobilepage = await getWebPage( url, browser, { viewport: MOBILE_VIEWPORT } );
				finalUrl = mobilepage.finalUrl;
			} catch ( error ) {
				if ( error.message.includes( "404" ) ) {
					throw error;
				} else if ( error.message.includes( "ENOTFOUND" ) || error.message.includes( "ERR_NAME_NOT_RESOLVED" ) ) {
					throw error;
				} else {
					throw new Error( `Mobile - Error loading mobile page for URL: ${ url } - ${ error.message }` );
				}
			}

			// find any videos that are either playing or above the fold
			updateProgressBar( index, url + " - " + 'Mobile Video Processing' );
			site[ 'Video Data - Mobile' ] = await get_video( mobilepage.page, MOBILE_VIEWPORT, url );

			// find any iframes that are above the fold
			updateProgressBar( index, url + " - " + 'Mobile Iframe Processing' );
			site[ 'Iframe Sources - Mobile' ] = await get_iframes( mobilepage.page, MOBILE_VIEWPORT );

			// maybe take a screenshot
			if ( site[ 'Video Data - Mobile' ] || site[ 'Iframe Sources - Mobile' ] ) {
				updateProgressBar( index, url + " - " + 'Mobile Screenshot' );
				site[ 'Above Fold - Mobile' ] = true;
				let mobileScreenshotPath = `${ OUTPUT_DIR }/screenshots/${ sanitizeUrlForFilename( url ) }-mobile.png`;
				await fs.promises.mkdir( path.dirname( mobileScreenshotPath ), { recursive: true } );
				await mobilepage.page.screenshot( { path: mobileScreenshotPath } );
			}
		} catch ( error ) {
			if ( error.message.includes( "404" ) ) {
				site[ 'Error - 404' ] = true;
				updateProgressBar( overallProgressBar, url + " 404" );
				updateProgressBar( index, url + " 404" );
				logErrorToFile( `${ url } - 404 - ${ error.message }` );
				saveToCSV( site );
				return;
			} else if ( error.message.includes( "ENOTFOUND" ) || error.message.includes( "ERR_NAME_NOT_RESOLVED" ) || error.message.includes( "NS_ERROR_UNKNOWN_HOST" ) ) {
				site[ 'Unresolved' ] = true;
				updateProgressBar( overallProgressBar, url + " Unresolved" );
				updateProgressBar( index, url + " Unresolved" );
				logErrorToFile( `${ url } - Unresolved - ${ error.message }` );
				saveToCSV( site );
				return;
			} else {
				site[ 'General Error' ] = true;
				updateProgressBar( overallProgressBar, url + " General Error" );
				updateProgressBar( index, url + " General Error" );
				logErrorToFile( `${ url } - Error during mobile  - ${ error.message }` );
				return;
			}
			// logErrorToFile( `Error during mobile scan for ${ url }: ${ error.message }` );
		} finally {
			if ( mobilepage && mobilepage.context ) {
				await mobilepage.context.close();
			}
		}
		// } )(),
		// ( async () => {
		try {
			updateProgressBar( index, url + " - " + 'Desktop scan' );
			desktoppage = await getWebPage( url, browser, { viewport: DESKTOP_VIEWPORT } );
			if ( !desktoppage ) throw new Error( 'Failed to load desktop page' );

			// find any videos that are either playing or above the fold
			updateProgressBar( index, url + " - " + 'Desktop Video Processing' );
			site[ 'Video Data - Desktop' ] = await get_video( desktoppage.page, DESKTOP_VIEWPORT, url );

			// find any iframes that are above the fold
			updateProgressBar( index, url + " - " + 'Desktop Iframe Processing' );
			site[ 'Iframe Sources - Desktop' ] = await get_iframes( desktoppage.page, DESKTOP_VIEWPORT );

			// maybe take a screenshot
			if ( site[ 'Video Data - Desktop' ] || site[ 'Iframe Sources - Desktop' ] ) {
				updateProgressBar( index, url + " - " + 'Desktop Screenshot' );
				site[ 'Above Fold - Desktop' ] = true;
				let desktopScreenshotPath = `${ OUTPUT_DIR }/screenshots/${ sanitizeUrlForFilename( url ) }-desktop.png`;
				await fs.promises.mkdir( path.dirname( desktopScreenshotPath ), { recursive: true } );
				await desktoppage.page.screenshot( { path: desktopScreenshotPath } );
			}
		} catch ( error ) {
			logErrorToFile( `Error during desktop scan for ${ url }: ${ error.message }` );
		} finally {
			if ( desktoppage && desktoppage.context ) {
				await desktoppage.context.close();
			}
		}
		// 	} )(),
		// ( async () => {
		updateProgressBar( index, url + " - " + 'SpeedyU lookup' );
		let speedyu = await fetchSpeedyuLighthouseData( url );
		if ( speedyu ) {
			let speedyuUrl = url.replace( "https://", "" ).replace( "http://", "" );
			site[ "SpeedyU - Link" ] = `https://speedyu.bravery.co/site/${ speedyuUrl }`;
			site[ "SpeedyU - Name" ] = speedyu.Name;
			site[ "SpeedyU - City" ] = speedyu.City;
			site[ "SpeedyU - State" ] = speedyu.State;
			site[ "SpeedyU - Country" ] = speedyu.Country;
			site[ "SpeedyU - Type" ] = speedyu.Control;
			site[ "SpeedyU - Rank" ] = speedyu.Rank;
			site[ "SpeedyU - Score" ] = Math.round( speedyu.CurrentTotal * 100 );
			site[ 'LH - Performance' ] = Math.round( speedyu.LighthousePerformance * 100 );
			site[ 'LH - Accessibility' ] = Math.round( speedyu.LighthouseAccessibility * 100 );
			site[ 'LH - BestPractices' ] = Math.round( speedyu.LighthouseBestPractices * 100 );
			site[ 'LH - SEO' ] = Math.round( speedyu.LighthouseSeo * 100 );
			site[ 'LH - Total Weight' ] = speedyu.LighthouseTotalByteWeight;
		}
		// } )(),		
		// ] );

		let iframes = site[ 'Iframe Sources - Mobile' ] || site[ 'Iframe Sources - Mobile' ];
		if ( iframes ) {
			site[ 'Iframe Source' ] = iframes[ 0 ];
		}

		let videodata = site[ 'Video Data - Mobile' ] || site[ 'Video Data - Desktop' ];

		// prep any video data found for the csv 
		if ( videodata ) {
			// Safely retrieve activeVideo
			let activeVideo = videodata.srcMetadata[ videodata.attrs[ 'Video Source' ] ];
			if ( activeVideo ) {
				site[ 'CC or Descriptive Track Found' ] = ( videodata.tracks.length > 0 );
				site[ 'Width' ] = activeVideo.width;
				site[ 'Height' ] = activeVideo.height;
				site[ 'Bitrate' ] = activeVideo.bit_rate;
				site[ 'Audio Present' ] = activeVideo.has_audio;
				site[ 'Codec' ] = activeVideo.codec;
				site[ 'Duration' ] = activeVideo.duration;
				site[ 'Framerate' ] = activeVideo.frame_rate;
				site[ 'File Size' ] = activeVideo.size;
				site[ 'Number of Video Sources' ] = videodata.src.length;
				site[ 'Self-Hosted' ] = videodata[ 'Self-hosted' ];
				site[ 'CDN Domain' ] = videodata[ 'CDN Domain' ];
				Object.assign( site, videodata.attrs );
			}
		}

		if (
			site[ 'Video Data - Mobile' ] && site[ 'Video Data - Desktop' ] && site[ 'Video Data - Mobile' ].attrs[ 'Video Source' ] != site[ 'Video Data - Desktop' ].attrs[ 'Video Source' ]
		) {
			site[ 'Mobile and Desktop Difference Src' ] = true;
		}

		// Maybe check against reduced motion and SaveData if the video still plays. 
		if ( site[ 'Video Data - Mobile' ] && site[ 'Video Data - Mobile' ].playing ) {
			updateProgressBar( index, url + " - " + 'Redudced Motion Check' );
			site[ 'Playing' ] = true;

			// Check if the video plays with reduced motion set
			let reducedMotionPage = await getWebPage( url, browser, { viewport: MOBILE_VIEWPORT, reducedMotion: 'reduce' } );
			if ( reducedMotionPage ) {
				let reducedMotionVideo = await get_video( reducedMotionPage.page, MOBILE_VIEWPORT, url );
				// console.log( "Desktop RD VIDEO", reducedMotionVideo.playing );
				site[ 'Playing - Low Motion' ] = ( reducedMotionVideo.playing ) ? true : false;
				await reducedMotionPage.context.close();
			}

		} else if ( site[ 'Video Data - Desktop' ] && site[ 'Video Data - Desktop' ].playing ) {
			updateProgressBar( index, url + " - " + 'Redudced Motion Check' );
			site[ 'Playing' ] = true;

			// Check if the video plays with reduced motion set
			let reducedMotionPage = await getWebPage( url, browser, { viewport: DESKTOP_VIEWPORT, reducedMotion: 'reduce' } );
			if ( reducedMotionPage ) {
				let reducedMotionVideo = await get_video( reducedMotionPage.page, DESKTOP_VIEWPORT, url );
				// console.log( "Desktop RD VIDEO", reducedMotionVideo.playing );
				site[ 'Playing - Low Motion' ] = ( reducedMotionVideo.playing ) ? true : false;
				await reducedMotionPage.context.close();
			}
		}

	} catch ( error ) {
		site[ 'General Error' ] = true;
		logErrorToFile( `Error scanning ${ url }: ${ error.message }` );
	} finally {
		// Ensure the browser is closed even if an error occurs
		if ( browser ) {
			try {
				updateProgressBar( index, url + " - " + 'Close Browser' );
				await browser.close();
				activeBrowsers = activeBrowsers.filter( b => b !== browser ); // Remove closed browser
			} catch ( error ) {
				logErrorToFile( `Error closing browser: ${ error.message }` );
			}
		}

		updateProgressBar( index, url + " - " + 'Save' );
		saveToCSV( site );
		updateProgressBar( index, url + " - " + 'Done', true );
		updateProgressBar( overallProgressBar, "Done - " + url );
	}

}

/**
 * Scans websites concurrently with a maximum number of concurrent scans.
 * @param {Array<string>} websites - An array of website URLs to scan.
 * @returns {Promise<void>} A promise that resolves when all scans are complete.
 */
async function scanWebsitesConcurrently( websites ) {
	const queue = [ ...websites ];
	const running = new Map(); // Map to track running scanners by index

	async function processNext() {
		if ( queue.length === 0 ) return;

		let url = queue.shift();
		// Find the first available index
		let availableIndex = Array.from( { length: MAX_CONCURRENT }, ( _, i ) => i ).find( i => !running.has( i ) );

		if ( availableIndex === undefined ) return;

		let promise = scanWebsite( url, availableIndex + 1 ) // Pass index to scanWebsite
			.catch( ( error ) => {
				logErrorToFile( `Error scanning ${ url }: ${ error.message }` );
			} )
			.finally( () => running.delete( availableIndex ) ); // Free up the index when done

		running.set( availableIndex, promise );
		await promise;

		// Process the next item in the queue if available
		if ( queue.length > 0 ) {
			await processNext();
		}
	}

	while ( queue.length > 0 || running.size > 0 ) {
		while ( running.size < MAX_CONCURRENT && queue.length > 0 ) {
			processNext();
		}
		await Promise.race( running.values() );
	}
}

/**
 * Logs error messages to a file.
 * @param {string} message - The error message to log.
 */
function logErrorToFile( message ) {
	const logFilePath = path.resolve( OUTPUT_DIR, 'error.log' );
	let timestamp = new Date().toISOString();
	fs.appendFileSync( logFilePath, `[${ timestamp }] ${ message }\n` );
}

let activeBrowsers = []; // Track active browser instances for cleanup

/**
 * Gracefully shuts down the script by closing all active browser instances.
 * @returns {Promise<void>} A promise that resolves when all browsers are closed.
 */
async function gracefulShutdown() {
	console.log( "\nGracefully shutting down..." );
	for ( let browser of activeBrowsers ) {
		try {
			await browser.close();
		} catch ( error ) {
			logErrorToFile( `Error closing browser during shutdown: ${ error.message }` );
		}
	}
	process.exit( 0 );
}

// Listen for termination signals
process.on( 'SIGINT', gracefulShutdown );
process.on( 'SIGTERM', gracefulShutdown );

/**
 * Main function to parse input and start the scanning process.
 * @returns {Promise<void>} A promise that resolves when the scanning process is complete.
 */
( async () => {
	program
		.argument( '<input>', 'A URL or file path containing URLs' )
		.option( '--country <country>', 'Country filter for SpeedyU data' )
		.parse( process.argv );

	const input = program.args[ 0 ];

	// Initialize the CSV file
	initializeCsv( CSV_FILE );

	const urls = [];
	if ( fs.existsSync( input ) ) {
		urls.push( ...getUrlsFromFile( input ) );
	} else if ( input.startsWith( "http://" ) || input.startsWith( "https://" ) ) {
		urls.push( input.trim().replace( /\/$/, '' ) );
	} else {
		process.exit();
	}
	progressbars[ overallProgressBar ] = individualProgressBars.create( urls.length, 0, { task: `Sites`, status: `Starting` } );
	// overallProgressBar.start( urls.length, 0 );

	await scanWebsitesConcurrently( urls );
	updateProgressBar( overallProgressBar, "Complete" );
	progressbars[ overallProgressBar ].stop();
	// console.log( "Scanning complete!" );
	process.exit( 0 );
} )();
