// node tests/media-delete-by-url.test.js — pure, no server, deletes nothing.
// Guards the URL → S3 key mapping behind mediaService.deleteByUrl (gallery
// deletes used to pass the full URL to deleteFile and never removed anything).
const { s3KeyFromUrl } = require('../src/services/media.service');

let fail = 0;
const eq = (name, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
    if (!ok) fail++;
};

const cdn = { aws_url: 'https://d2423c9j40z83w.cloudfront.net', aws_bucket: 'my-bucket', aws_region: 'ap-south-1' };

eq('CloudFront URL → key',
    s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/event-gallery/30/vid-1-abc.mp4', cdn),
    'event-gallery/30/vid-1-abc.mp4');
eq('aws_url with trailing slash',
    s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/a/b.jpg', { ...cdn, aws_url: 'https://d2423c9j40z83w.cloudfront.net/' }),
    'a/b.jpg');
eq('bucket S3 URL → key',
    s3KeyFromUrl('https://my-bucket.s3.ap-south-1.amazonaws.com/x/y.png', cdn),
    'x/y.png');
eq('query string dropped',
    s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/a/b.jpg?v=2', cdn),
    'a/b.jpg');
eq('custom prefix kept as part of key',
    s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/tenant1/event-gallery/1/p.jpg', cdn),
    'tenant1/event-gallery/1/p.jpg');
eq('foreign host refused', s3KeyFromUrl('https://evil.example.com/event-gallery/1/p.jpg', cdn), null);
eq('look-alike host refused', s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net.evil.com/a.jpg', cdn), null);
eq('path traversal refused', s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/a/../../b.jpg', cdn), null);
eq('bare base refused', s3KeyFromUrl('https://d2423c9j40z83w.cloudfront.net/', cdn), null);
eq('empty / null refused', s3KeyFromUrl(null, cdn), null);

console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
