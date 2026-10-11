// Generates every made-up fixture into ~/.cache/stash2flow-spikes/fixtures (nothing is committed).
// Run: node backend/spikes/fixtures.ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { CACHE, FIXTURES, type Lang } from './lib.ts'

mkdirSync(FIXTURES, { recursive: true })

// --- photos: two different invented scenes -------------------------------------------------
const sceneA = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a6fd6"/><stop offset="1" stop-color="#bfe3ff"/></linearGradient></defs>
<rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="170" r="90" fill="#ffd23f"/>
<polygon points="0,800 0,520 250,300 480,560 700,380 1000,640 1200,500 1200,800" fill="#3b7a3b"/>
<rect x="150" y="560" width="220" height="160" fill="#b5651d"/><polygon points="130,560 260,460 390,560" fill="#8b1a1a"/>
<rect x="230" y="620" width="60" height="100" fill="#3a2a1a"/></svg>`
const sceneB = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
<rect width="1200" height="800" fill="#101828"/><circle cx="220" cy="600" r="260" fill="#e4572e"/>
<rect x="600" y="100" width="450" height="450" fill="#76b041"/><circle cx="800" cy="330" r="120" fill="#101828"/>
<polygon points="100,100 500,80 300,350" fill="#f3a712"/><rect x="520" y="620" width="600" height="60" fill="#a8c686"/></svg>`

const photoA = await sharp(Buffer.from(sceneA)).png().toBuffer()
const photoB = await sharp(Buffer.from(sceneB)).png().toBuffer()
writeFileSync(join(FIXTURES, 'photo-a.png'), photoA)
writeFileSync(join(FIXTURES, 'photo-a-small.png'), await sharp(photoA).resize(400).png().toBuffer())
writeFileSync(
  join(FIXTURES, 'photo-a-q30.jpg'),
  await sharp(photoA).jpeg({ quality: 30 }).toBuffer(),
)
writeFileSync(join(FIXTURES, 'photo-b.png'), photoB)
execFileSync(
  'python3',
  [
    join(import.meta.dirname, 'make-heic.py'),
    join(FIXTURES, 'photo-a.png'),
    join(FIXTURES, 'photo-a.heic'),
  ],
  {
    env: { ...process.env, PYTHONPATH: join(CACHE, 'pylib') },
  },
)

// --- scanned-looking pages with invented text ----------------------------------------------
export const PAGES: Record<Lang, string[][]> = {
  por: [
    [
      'Prefeitura de Vila Imaginária',
      'Certidão de Quitação no 000.000/0000',
      'Certificamos que Joaquim Exemplo da Conceição, inscrito sob o',
      'número 000.000.000-00 (inválido), está em dia com as obrigações',
      'municipais referentes ao exercício de 2019. A presente certidão',
      'é válida por noventa dias, contados da emissão. São Tomé do Sul,',
      '12 de março de 2020. Assinado: Maria Fictícia, Diretora.',
    ],
    [
      'Contrato de Locação Residencial',
      'Locador: Ana Inventada Müller. Locatário: Pedro de Teste Silva.',
      'O imóvel situado à Rua das Árvores Inexistentes, 123, ficará',
      'alugado por trinta e seis meses. O aluguel mensal é de',
      'quinhentos euros, reajustado anualmente. Fica eleito o foro',
      'da comarca de Nenhures para dirimir quaisquer questões.',
    ],
  ],
  deu: [
    [
      'Stadtwerke Beispielhausen GmbH',
      'Jahresabrechnung Strom Nr. 000-000-0000',
      'Sehr geehrter Herr Max Mustermann, für den Zeitraum vom 1. Januar',
      'bis 31. Dezember 2021 haben wir Ihren Verbrauch abgerechnet. Der',
      'Gesamtbetrag über zweihundertdreißig Euro wird zum fünfzehnten',
      'des Folgemonats abgebucht. Bei Rückfragen erreichen Sie uns',
      'unter der Erfindungsstraße 7 in Übergrünstadt.',
    ],
    [
      'Mietvertrag über Wohnräume',
      'Vermieterin: Erika Ausgedacht. Mieter: Hans Probe-Größe.',
      'Die Wohnung in der Nirgendwoer Gasse 5 wird ab dem ersten',
      'Mai unbefristet vermietet. Die monatliche Kaltmiete beträgt',
      'sechshundert Euro; Nebenkosten werden jährlich abgerechnet.',
      'Schönheitsreparaturen übernimmt der Mieter auf eigene Kosten.',
    ],
  ],
  eng: [
    [
      'Imaginary Valley Health Clinic',
      'Appointment Confirmation Ref. 000-TEST-000',
      'Dear Mr. Jonathan Placeholder, this letter confirms your visit on',
      'the fourteenth of June at nine thirty in the morning. Please bring',
      'your insurance card, a list of current medication and a photo',
      'identification. If you cannot attend, call us at least one day',
      'before. Sincerely, Dr. Alice Madeup, Front Desk.',
    ],
    [
      'Invoice for Consulting Services',
      'Issuer: Fictional Widgets Ltd. Customer: Sample Person.',
      'Services rendered between January and March include a review of',
      'the reporting process and two workshops. The total due is',
      'one thousand two hundred pounds, payable within thirty days of',
      'receipt by bank transfer to the account named on this page.',
    ],
  ],
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const W = 1240
const H = 1754
for (const lang of Object.keys(PAGES) as Lang[]) {
  for (const [i, lines] of PAGES[lang].entries()) {
    const text = lines
      .map(
        (l, n) =>
          `<text x="110" y="${200 + n * 64}" font-family="DejaVu Serif" font-size="30" fill="#1a1a1a">${esc(l)}</text>`,
      )
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fdfdfb"/>${text}</svg>`
    const rotated = await sharp(Buffer.from(svg))
      .rotate(1.2 * (i ? -1 : 1), { background: '#fdfdfb' })
      .toBuffer()
    const noise = await sharp({
      create: {
        width: W,
        height: H,
        channels: 3,
        background: '#f4f4f4',
        noise: { type: 'gaussian', mean: 240, sigma: 14 },
      },
    })
      .png()
      .toBuffer()
    const page = await sharp(rotated)
      .composite([{ input: noise, blend: 'multiply' }])
      .png()
      .toBuffer()
    writeFileSync(join(FIXTURES, `page-${lang}-${i}.png`), page)
    writeFileSync(join(FIXTURES, `page-${lang}-${i}.txt`), lines.join('\n'))
  }
}

// --- text for the embedding questions ------------------------------------------------------
writeFileSync(
  join(FIXTURES, 'docs.json'),
  JSON.stringify([
    {
      id: 'por-rent',
      text: 'Contrato de locação residencial: o locatário paga aluguel mensal pelo imóvel alugado por trinta e seis meses.',
    },
    {
      id: 'deu-power',
      text: 'Jahresabrechnung Strom: der Verbrauch wird abgerechnet und der Gesamtbetrag abgebucht.',
    },
    {
      id: 'eng-clinic',
      text: 'Appointment confirmation: please bring your insurance card to the clinic visit.',
    },
    {
      id: 'por-recipe',
      text: 'Receita de bolo de cenoura com cobertura de chocolate: misture os ovos, o óleo e as cenouras.',
    },
  ]),
)
console.log('fixtures written to', FIXTURES)
