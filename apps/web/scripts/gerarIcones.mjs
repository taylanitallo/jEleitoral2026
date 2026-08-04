/**
 * Gera os ícones do PWA a partir do acento da marca.
 *
 * `node scripts/gerarIcones.mjs`
 *
 * Por que gerar em vez de versionar binários prontos: o acento vive em
 * `tokens.css` e muda por campanha. Um PNG solto no repositório vira a única
 * peça que ninguém sabe recriar quando a cor muda — e ícone de PWA é a coisa
 * que o entrevistador toca na tela inicial do celular todo dia.
 *
 * O codificador é mínimo de propósito: PNG RGBA sem filtro, comprimido pelo
 * zlib do próprio Node. Acrescentar `sharp` ao projeto por três ícones estáticos
 * custaria mais em instalação e manutenção do que estas 60 linhas.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESTINO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public');

// hsl(221 83% 45%) — `--acento` em `pacotes/ui/src/tema/tokens.css`.
const MARCA = [20, 80, 210];
const BRANCO = [255, 255, 255];

// --- PNG ---------------------------------------------------------------------

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados) {
  let c = 0xffffffff;
  for (const byte of dados) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pedaco(tipo, dados) {
  const comprimento = Buffer.alloc(4);
  comprimento.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(corpo));
  return Buffer.concat([comprimento, corpo, verificacao]);
}

function codificarPng(largura, altura, pixels) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // 8 bits por canal
  cabecalho[9] = 6; // RGBA
  // compressão, filtro e entrelaçamento ficam em 0.

  // Cada linha leva um byte de filtro à frente; 0 = sem filtro.
  const linhas = Buffer.alloc(altura * (1 + largura * 4));
  for (let y = 0; y < altura; y += 1) {
    const inicio = y * (1 + largura * 4);
    linhas[inicio] = 0;
    pixels.copy(linhas, inicio + 1, y * largura * 4, (y + 1) * largura * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

// --- Desenho -----------------------------------------------------------------

/** Cobertura de 0 a 1 na borda, para o traço não sair serrilhado. */
const suavizar = (distancia) => Math.min(1, Math.max(0, 0.5 - distancia));

/** Distância de um ponto ao segmento AB — usada para desenhar o traço. */
function distanciaAoSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimento = dx * dx + dy * dy;
  const t = comprimento === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / comprimento));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distância ao retângulo de cantos arredondados, negativa dentro. */
function distanciaAoRetangulo(px, py, lado, raio) {
  const meio = lado / 2;
  const qx = Math.abs(px - meio) - (meio - raio);
  const qy = Math.abs(py - meio) - (meio - raio);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - raio;
}

/**
 * Um visto branco sobre o fundo da marca.
 *
 * `mascaravel` preenche o quadrado inteiro e encolhe o desenho para a zona
 * segura de 80%: o Android recorta o ícone em círculo ou em bolha conforme o
 * aparelho, e um visto desenhado até a borda perde a ponta.
 */
function desenhar(lado, { mascaravel }) {
  const pixels = Buffer.alloc(lado * lado * 4);
  const raio = mascaravel ? 0 : lado * 0.22;
  const escala = mascaravel ? 0.8 : 1;
  const deslocamento = (lado * (1 - escala)) / 2;

  // Proporções do visto, em fração do lado, medidas na área útil.
  const p = (fx, fy) => [deslocamento + lado * escala * fx, deslocamento + lado * escala * fy];
  const [ax, ay] = p(0.28, 0.52);
  const [bx, by] = p(0.44, 0.68);
  const [cx, cy] = p(0.73, 0.34);
  const espessura = lado * escala * 0.085;

  for (let y = 0; y < lado; y += 1) {
    for (let x = 0; x < lado; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const dentroFundo = mascaravel ? 1 : suavizar(distanciaAoRetangulo(px, py, lado, raio));
      const noVisto = suavizar(
        Math.min(
          distanciaAoSegmento(px, py, ax, ay, bx, by),
          distanciaAoSegmento(px, py, bx, by, cx, cy),
        ) - espessura / 2,
      );

      const cor = [0, 1, 2].map((canal) =>
        Math.round(MARCA[canal] + (BRANCO[canal] - MARCA[canal]) * noVisto),
      );

      const i = (y * lado + x) * 4;
      pixels[i] = cor[0];
      pixels[i + 1] = cor[1];
      pixels[i + 2] = cor[2];
      pixels[i + 3] = Math.round(255 * dentroFundo);
    }
  }

  return codificarPng(lado, lado, pixels);
}

mkdirSync(DESTINO, { recursive: true });

const arquivos = [
  ['icone-192.png', 192, { mascaravel: false }],
  ['icone-512.png', 512, { mascaravel: false }],
  ['icone-mascaravel-512.png', 512, { mascaravel: true }],
  // O iOS não respeita transparência na tela inicial: pinta o fundo de preto.
  // Por isso o ícone da Apple é o de sangria total, e não o de cantos vazados.
  ['apple-touch-icon.png', 180, { mascaravel: true }],
];

for (const [nome, lado, opcoes] of arquivos) {
  writeFileSync(resolve(DESTINO, nome), desenhar(lado, opcoes));
  process.stdout.write(`  ${nome} (${lado}×${lado})\n`);
}
