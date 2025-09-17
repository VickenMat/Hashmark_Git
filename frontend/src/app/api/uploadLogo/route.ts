// app/api/uploadLogo/route.ts
import { NextResponse } from 'next/server';

function gatewayBase() {
  const raw = (process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud').trim();
  return raw.replace(/\/ipfs\/?$/i, '').replace(/\/+$/, '');
}

function parseDataUrl(dataUrl: string) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Invalid dataUrl');
  const [, mime, b64] = m;
  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  return { mime, ext, bytes: Buffer.from(b64, 'base64') };
}

export async function POST(req: Request) {
  try {
    const { dataUrl } = (await req.json()) as { dataUrl?: string };
    if (!dataUrl) return NextResponse.json({ error: 'Missing dataUrl' }, { status: 400 });

    const jwt = process.env.PINATA_JWT;
    if (!jwt) return NextResponse.json({ error: 'PINATA_JWT missing' }, { status: 500 });

    const { mime, ext, bytes } = parseDataUrl(dataUrl);
    const filename = `team-logo-${Date.now()}.${ext}`;

    const form = new FormData();
    // Only THIS field is a file
    form.append('file', new Blob([bytes], { type: mime }), filename);
    // These MUST be strings (sending them as Blobs triggers "Unexpected field")
    form.append('pinataMetadata', JSON.stringify({ name: filename }));
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });

    const j = await r.json();
    if (!r.ok) {
      return NextResponse.json({ error: 'Pinata upload failed', detail: j }, { status: 500 });
    }

    const cid: string | undefined = j.IpfsHash;
    if (!cid) {
      return NextResponse.json({ error: 'Pinata upload succeeded but missing IpfsHash', detail: j }, { status: 500 });
    }

    const uri = `${gatewayBase()}/ipfs/${cid}`;
    return NextResponse.json({ cid, uri });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload error' }, { status: 500 });
  }
}
