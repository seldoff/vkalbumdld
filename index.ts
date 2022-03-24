import puppeteer from 'puppeteer';
import fs from 'fs';
import fetch from 'node-fetch';
import modifyExif from 'modify-exif';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: getPuppeteerChromePath(),
        headless: false,
        defaultViewport: {width: 1024, height: 768}
    });
    const page = await browser.newPage();
    try {
        page.waitForSelector('a.JoinForm__notNowLink', {timeout: 0}).then(e => e?.click());

        for (let i = 2; i < process.argv.length; i++) {
            try {
                await downloadAlbum(page, process.argv[i]);
            } catch (e) {
                console.error(e);
            }
        }
    } finally {
        await page.close();
        await browser.close();
    }
})();

function getPuppeteerChromePath(): string {
    if ((process as any).pkg) {
        // When running from the packaged binary, chromium is placed beneath the executable.
        return './chromium/chrome.exe';
    } else {
        let executablePath = (puppeteer as any).executablePath();
        const parts = executablePath.split('.local-chromium');
        // Bundling with esbuild breaks path resolution inside puppeteer. Fixing it.
        parts[0] = './node_modules/puppeteer/';
        return `${parts[0]}/.local-chromium/${parts[1]}`;
    }
}

async function downloadAlbum(page: puppeteer.Page, album: string) {
    console.log(`Downloading album ${album}`);
    await page.goto(album, {waitUntil: 'networkidle2'});

    let title = await textSafe(page, '.photos_album_intro h1');
    title = title || getLastUrlPart(page.url());
    console.log(`Downloading to ${title}`);
    fs.mkdirSync(`./${title}`);

    const photo = await page.$('div.photos_row a');
    if (!photo) {
        console.log('No photos in album');
        return;
    }
    const seenPhotos = new Set<string>();
    await photo.click();

    let idx = 0;
    while (true) {
        idx++;
        console.log(`Processing photo #${idx}`);

        const src = await getSrc(page);
        if (!src) {
            console.log('No src');
            break;
        }
        if (seenPhotos.has(src)) {
            console.log('End of album');
            break;
        }
        seenPhotos.add(src);

        const fileName = `./${title}/${idx}_${getLastUrlPart(src)}`;
        if (!fs.existsSync(fileName)) {
            let date = parseDate(await text(page, '.rel_date'));
            if (!date) {
                console.warn(`Can't get date for ${page.url()}`);
                date = new Date();
            }

            console.log(`Downloading ${src} to ${fileName}`);
            try {
                const response = await fetch(src);
                const data = await response.arrayBuffer();

                const modified: Buffer = modifyExif(Buffer.from(data), (d: any) => {
                    let timestamp = date!.getTime();
                    timestamp += idx * 1000;
                    const ad = new Date(timestamp);
                    d.Exif['36867'] = `${ad.getFullYear()}:${ad.getMonth() + 1}:${ad.getDate()} ${ad.getHours()}:${ad.getMinutes()}:${ad.getSeconds()}`;
                });

                fs.writeFileSync(fileName, modified);
            } catch (e) {
                console.error(e);
            }
        } else {
            console.log(`Already downloaded ${src}, skipping`);
        }

        await delay(200 + 200 * Math.random());
        await page.keyboard.press('ArrowRight');
        while (src === await getSrc(page)) {
            await delay(50);
        }
    }
}

function getLastUrlPart(url: string): string {
    const srcParts = new URL(url).pathname.split('/');
    return srcParts[srcParts.length - 1];
}

async function getSrc(page: puppeteer.Page): Promise<string | undefined> {
    const img = await page.waitForSelector('#pv_photo img');
    return (await img?.getProperty('src'))?.jsonValue<string>();
}

function parseDate(dateStr: string): Date | null {
    let date: Date | null = null;

    const dateParts = dateStr.split(' ');
    if (dateParts.length === 3) {
        const day = parseInt(dateParts[0]);
        const monthStr = dateParts[1];
        const year = parseInt(dateParts[2]);

        let month: number = -1;
        switch (monthStr.toLowerCase()) {
            case 'jan': {
                month = 1;
                break;
            }
            case 'feb': {
                month = 2;
                break;
            }
            case 'mar': {
                month = 3;
                break;
            }
            case 'apr': {
                month = 4;
                break;
            }
            case 'may': {
                month = 5;
                break;
            }
            case 'jun': {
                month = 6;
                break;
            }
            case 'jul': {
                month = 7;
                break;
            }
            case 'aug': {
                month = 8;
                break;
            }
            case 'sep': {
                month = 9;
                break;
            }
            case 'oct': {
                month = 10;
                break;
            }
            case 'nov': {
                month = 11;
                break;
            }
            case 'dec': {
                month = 12;
                break;
            }
        }

        if (!isNaN(day) && !isNaN(year) && month >= 1) {
            date = new Date(year, month - 1, day);
        }
    }

    return date;
}

function delay(ms: number): Promise<void> {
    return new Promise<void>(r => setTimeout(r, ms));
}

async function textSafe(page: puppeteer.Page, selector: string): Promise<string | undefined> {
    return (await (await page.$(selector))?.getProperty('innerText'))?.jsonValue<string>();
}

async function text(page: puppeteer.Page, selector: string): Promise<string> {
    const r = await textSafe(page, selector);
    if (!r) {
        throw new Error(`No text for selector '${selector}'`);
    }
    return r;
}