#!/usr/bin/env python3
"""
generate_demo_gif.py
Draws each frame as a proper image using Pillow — no terminal rendering,
no double-width character issues.
"""

from PIL import Image, ImageDraw, ImageFont
import os, sys

# ── Data ──────────────────────────────────────────────────────────────────────
BASELINE_TOKENS  = [108,1208,2340,3447,4568,5688,6820,7929,9037,10153,
                    11251,12345,13474,14591,15692,16805,17913,19008,20124,21220]
OPTIMIZED_TOKENS = [108,1208,2340,2288,1239,1251,2301,2290,2358,2342,
                    3370,3357,3446,3448,4490,4510,4577,4544,5583,5578]
BASELINE_QUAL    = [8.2,7.1,7.1,7.7,7.3,6.4,8.2,8.2,7.3,6.0,
                    7.3,7.7,7.3,7.7,7.3,6.0,7.7,8.2,6.9,8.2]
OPTIMIZED_QUAL   = [7.7,8.9,9.4,9.4,8.5,6.4,8.2,8.4,7.7,7.3,
                    8.2,7.7,7.7,7.7,8.2,9.4,8.2,8.2,7.3,9.4]
TOPICS = [
    "architecture","architecture","refactor","bug fixing","memory system",
    "provider router","refactor","bug fixing","cli optimization","testing",
    "deployment","architecture","refactor","bug fixing","provider router",
    "testing","cli optimization","deployment","refactor","deployment",
]
CHECKPOINTS = {8, 12, 16, 20}

# ── Colours (Dracula-ish palette) ─────────────────────────────────────────────
BG       = (30,  30,  30)
BG2      = (40,  42,  54)
BG3      = (50,  52,  64)
BORDER   = (68,  71,  90)
FG       = (248, 248, 242)
DIM      = (150, 150, 160)
RED      = (255,  85,  85)
GREEN    = ( 80, 250, 123)
YELLOW   = (241, 250, 140)
CYAN     = (139, 233, 253)
WHITE    = (255, 255, 255)

# ── Canvas ────────────────────────────────────────────────────────────────────
W, H     = 960, 560
PAD      = 24
COL_DIV  = W // 2          # x-position of centre divider

# ── Font ─────────────────────────────────────────────────────────────────────
def load_font(size):
    candidates = [
        r"C:\Windows\Fonts\consola.ttf",
        r"C:\Windows\Fonts\cour.ttf",
        r"C:\Windows\Fonts\lucon.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

FONT_SM  = load_font(13)
FONT_MD  = load_font(15)
FONT_LG  = load_font(20)
FONT_XL  = load_font(28)

# ── Drawing helpers ───────────────────────────────────────────────────────────

def text_w(text, font):
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]

def text_h(font):
    bbox = font.getbbox("Ag")
    return bbox[3] - bbox[1]

def draw_text(d, x, y, text, font, color=FG):
    d.text((x, y), text, font=font, fill=color)

def draw_hline(d, x1, x2, y, color=BORDER):
    d.line([(x1, y), (x2, y)], fill=color, width=1)

def draw_vline(d, x, y1, y2, color=BORDER):
    d.line([(x, y1), (x, y2)], fill=color, width=1)

def draw_rect(d, x1, y1, x2, y2, fill=None, outline=BORDER):
    if fill:
        d.rectangle([x1, y1, x2, y2], fill=fill)
    if outline:
        d.rectangle([x1, y1, x2, y2], outline=outline)

def draw_bar(d, x, y, w, h, value, max_val, color):
    """Draw a filled progress bar."""
    filled = int((value / max_val) * w)
    # Background track
    d.rectangle([x, y, x + w, y + h], fill=BG3)
    # Filled portion
    if filled > 0:
        d.rectangle([x, y, x + filled, y + h], fill=color)
    # Border
    d.rectangle([x, y, x + w, y + h], outline=BORDER)

def num_fmt(n):
    return f"{n:,}"

# ── Section layout ────────────────────────────────────────────────────────────
TITLE_H   = 44
TOPIC_H   = 32
COL_TOP   = TITLE_H + TOPIC_H
COL_H     = 240
CHART_TOP = COL_TOP + COL_H + 10
CHART_H   = 130
FOOT_TOP  = CHART_TOP + CHART_H + 10

# ── Frame builders ─────────────────────────────────────────────────────────────

def new_img():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

def draw_title_bar(d, round_num=None, total=20):
    d.rectangle([0, 0, W, TITLE_H], fill=BG2)
    draw_text(d, PAD, 12, "Deja", FONT_LG, CYAN)
    tw = text_w("Deja", FONT_LG)
    draw_text(d, PAD + tw + 8, 16, "-- Live Session Comparison", FONT_MD, DIM)
    if round_num:
        label = f"Round {round_num} / {total}"
        lw = text_w(label, FONT_MD)
        draw_text(d, W - PAD - lw, 14, label, FONT_MD,
                  YELLOW if round_num in CHECKPOINTS else FG)
    draw_hline(d, 0, W, TITLE_H, BORDER)

def draw_topic_bar(d, topic, is_checkpoint=False):
    y = TITLE_H
    d.rectangle([0, y, W, y + TOPIC_H], fill=BG2)
    label = f"Topic:  {topic}"
    if is_checkpoint:
        label += "   * memory checkpoint"
    draw_text(d, PAD, y + 8, label, FONT_SM,
              YELLOW if is_checkpoint else DIM)
    draw_hline(d, 0, W, y + TOPIC_H, BORDER)

def draw_column_headers(d):
    y = COL_TOP
    mid = COL_DIV
    # Left header
    d.rectangle([0, y, mid - 1, y + 30], fill=(60, 20, 20))
    draw_text(d, PAD, y + 7, "X  WITHOUT Deja", FONT_MD, RED)
    # Right header
    d.rectangle([mid + 1, y, W, y + 30], fill=(20, 50, 30))
    draw_text(d, mid + PAD, y + 7, "O  WITH Deja", FONT_MD, GREEN)
    # Divider line
    draw_vline(d, mid, y, COL_TOP + COL_H, BORDER)
    draw_hline(d, 0, W, y + 30, BORDER)

def draw_token_section(d, b_tok, o_tok, col_top_offset):
    y = COL_TOP + col_top_offset
    mid = COL_DIV
    max_tok = 22000
    bar_w = (mid - PAD * 2 - 100)
    bar_h = 18

    # Left: baseline tokens
    draw_text(d, PAD, y, "Tokens sent:", FONT_SM, DIM)
    draw_text(d, PAD, y + 18, num_fmt(b_tok), FONT_LG, RED)
    draw_bar(d, PAD, y + 48, bar_w, bar_h, b_tok, max_tok, RED)

    # Right: optimized tokens
    draw_text(d, mid + PAD, y, "Tokens sent:", FONT_SM, DIM)
    draw_text(d, mid + PAD, y + 18, num_fmt(o_tok), FONT_LG, GREEN)
    draw_bar(d, mid + PAD, y + 48, bar_w, bar_h, o_tok, max_tok, GREEN)

    # Savings badge
    if b_tok > 0 and b_tok != o_tok:
        pct = (b_tok - o_tok) / b_tok * 100
        badge = f"-{pct:.1f}%"
        bw = text_w(badge, FONT_LG)
        bx = mid + PAD + text_w(num_fmt(o_tok), FONT_LG) + 12
        d.rectangle([bx - 4, y + 16, bx + bw + 4, y + 38], fill=(20, 60, 30))
        draw_text(d, bx, y + 18, badge, FONT_LG, GREEN)

def draw_quality_section(d, b_q, o_q, col_top_offset):
    y = COL_TOP + col_top_offset
    mid = COL_DIV

    draw_text(d, PAD, y, "Quality:", FONT_SM, DIM)
    draw_text(d, PAD + 70, y, f"{b_q:.1f} / 10", FONT_MD, FG)

    draw_text(d, mid + PAD, y, "Quality:", FONT_SM, DIM)
    q_color = GREEN if o_q >= b_q else YELLOW
    draw_text(d, mid + PAD + 70, y, f"{o_q:.1f} / 10", FONT_MD, q_color)

def draw_chart(d, round_idx):
    """Draw token growth line chart for rounds 0..round_idx."""
    x0 = PAD + 50
    y0 = CHART_TOP
    cw = W - PAD * 2 - 50
    ch = CHART_H - 20

    draw_text(d, PAD, y0, "Token growth:", FONT_SM, DIM)
    draw_hline(d, x0, x0 + cw, y0 + ch, BORDER)
    draw_vline(d, x0, y0, y0 + ch, BORDER)

    max_tok = 22000
    n = round_idx + 1
    step = cw / max(19, 1)

    def px(i):
        return int(x0 + i * (cw / 19))

    def py(v):
        return int(y0 + ch - (v / max_tok) * ch)

    # Draw baseline line (red)
    pts_b = [(px(i), py(BASELINE_TOKENS[i])) for i in range(n)]
    if len(pts_b) >= 2:
        d.line(pts_b, fill=RED, width=2)
    for pt in pts_b:
        d.ellipse([pt[0]-3, pt[1]-3, pt[0]+3, pt[1]+3], fill=RED)

    # Draw optimized line (green)
    pts_o = [(px(i), py(OPTIMIZED_TOKENS[i])) for i in range(n)]
    if len(pts_o) >= 2:
        d.line(pts_o, fill=GREEN, width=2)
    for pt in pts_o:
        d.ellipse([pt[0]-3, pt[1]-3, pt[0]+3, pt[1]+3], fill=GREEN)

    # Y-axis labels
    for v, label in [(0, "0"), (5000, "5k"), (10000, "10k"), (15000, "15k"), (20000, "20k")]:
        yp = py(v)
        if y0 <= yp <= y0 + ch:
            draw_text(d, PAD, yp - 7, label, FONT_SM, DIM)
            draw_hline(d, x0, x0 + cw, yp, (50, 50, 60))

    # Legend
    lx = x0 + cw - 180
    ly = y0 + 2
    d.ellipse([lx, ly+5, lx+8, ly+13], fill=RED)
    draw_text(d, lx + 14, ly, "baseline", FONT_SM, RED)
    d.ellipse([lx + 90, ly+5, lx+98, ly+13], fill=GREEN)
    draw_text(d, lx + 104, ly, "optimized", FONT_SM, GREEN)

def draw_footer(d, round_idx):
    b_total = sum(BASELINE_TOKENS[:round_idx + 1])
    o_total = sum(OPTIMIZED_TOKENS[:round_idx + 1])
    saved   = b_total - o_total
    pct     = (saved / b_total * 100) if b_total > 0 else 0

    y = FOOT_TOP
    draw_hline(d, 0, W, y, BORDER)

    if saved > 0:
        parts = [
            ("Cumulative saved:  ", FG),
            (f"{num_fmt(saved)} tokens", GREEN),
            (f"  ({pct:.1f}%)  |  ", GREEN),
            (f"{num_fmt(b_total)}", RED),
            (" baseline  vs  ", DIM),
            (f"{num_fmt(o_total)}", GREEN),
            (" optimized", DIM),
        ]
    else:
        parts = [("Sessions identical — compression kicks in as history grows...", DIM)]

    x = PAD
    for text, color in parts:
        draw_text(d, x, y + 10, text, FONT_MD, color)
        x += text_w(text, FONT_MD)

# ── Full frame renderers ──────────────────────────────────────────────────────

def make_intro():
    img, d = new_img()
    cx = W // 2

    y = 80
    draw_text(d, cx - text_w("Deja", FONT_XL)//2, y, "Deja", FONT_XL, CYAN)
    y += 50
    sub = "Context compression for AI coding sessions"
    draw_text(d, cx - text_w(sub, FONT_MD)//2, y, sub, FONT_MD, DIM)

    y += 60
    draw_hline(d, PAD * 4, W - PAD * 4, y, BORDER)

    y += 30
    q = "What happens to your Claude Code session after 20 rounds?"
    draw_text(d, cx - text_w(q, FONT_MD)//2, y, q, FONT_MD, FG)

    y += 50
    row1 = "Without Deja:   round 1 ->    108 tokens     round 20 ->  21,220 tokens"
    draw_text(d, cx - text_w(row1, FONT_MD)//2, y, "Without Deja:", FONT_MD, RED)
    x2 = PAD * 4 + text_w("Without Deja:", FONT_MD) + 8
    draw_text(d, cx - text_w(row1, FONT_MD)//2 + text_w("Without Deja:", FONT_MD) + 8,
              y, "  round 1 ->    108 tokens     round 20 ->  21,220 tokens", FONT_MD, FG)

    y += 30
    draw_text(d, cx - text_w(row1, FONT_MD)//2, y, "With Deja:   ", FONT_MD, GREEN)
    draw_text(d, cx - text_w(row1, FONT_MD)//2 + text_w("Without Deja:", FONT_MD) + 8,
              y, "  round 1 ->    108 tokens     round 20 ->   5,578 tokens", FONT_MD, FG)

    y += 60
    note = "Starting live comparison  --  20 rounds..."
    draw_text(d, cx - text_w(note, FONT_SM)//2, y, note, FONT_SM, DIM)

    return img

def make_round_frame(round_num):
    i = round_num - 1
    img, d = new_img()

    draw_title_bar(d, round_num)
    draw_topic_bar(d, TOPICS[i], round_num in CHECKPOINTS)
    draw_column_headers(d)

    # Token section (offset from COL_TOP + 32 header)
    draw_token_section(d, BASELINE_TOKENS[i], OPTIMIZED_TOKENS[i], 40)
    draw_quality_section(d, BASELINE_QUAL[i], OPTIMIZED_QUAL[i], 170)

    # Horizontal line at bottom of col area
    draw_hline(d, 0, W, COL_TOP + COL_H, BORDER)

    draw_chart(d, i)
    draw_footer(d, i)

    return img

def make_final():
    img, d = new_img()
    cx = W // 2

    # Header
    d.rectangle([0, 0, W, TITLE_H], fill=BG2)
    draw_text(d, PAD, 12, "Deja", FONT_LG, CYAN)
    tw = text_w("Deja", FONT_LG)
    draw_text(d, PAD + tw + 8, 16, "-- 20-round benchmark  (real Claude Sonnet API)", FONT_MD, DIM)
    draw_hline(d, 0, W, TITLE_H, BORDER)

    # Table
    rows = [
        ("Metric",              "Baseline",  "Deja",    "Delta"),
        ("Total prompt tokens", "213,721",   "60,628",  "-71.6%"),
        ("Final round tokens",  "21,220",    "5,578",   "-73.7%"),
        ("Avg quality",         "7.4 / 10",  "8.2 / 10","  +0.8"),
        ("Memory retention",    "10 / 10",   "10 / 10", "  100%"),
    ]
    col_x  = [PAD, 340, 520, 700]
    row_h  = 38
    t_top  = TITLE_H + 30
    tw_end = 860

    for ri, row in enumerate(rows):
        y = t_top + ri * row_h
        # Row background
        bg = BG2 if ri % 2 == 0 else BG
        if ri == 0:
            bg = BG3
        d.rectangle([PAD - 4, y, tw_end, y + row_h - 2], fill=bg)

        colors = [FG, RED, GREEN, GREEN]
        if ri == 0:
            colors = [DIM, DIM, DIM, DIM]
        if ri > 1:
            colors[3] = YELLOW

        for ci, (text, color) in enumerate(zip(row, colors)):
            align = "r" if ci > 0 else "l"
            fx = col_x[ci]
            if align == "r":
                fx = col_x[ci] + 150 - text_w(text, FONT_MD)
            font = FONT_LG if (ri > 0 and ci > 0) else FONT_MD
            draw_text(d, fx, y + 8, text, font, color)

    # Tagline
    y = t_top + len(rows) * row_h + 30
    tag = "71.6% fewer tokens.  Better quality.  Zero memory loss."
    draw_text(d, cx - text_w(tag, FONT_LG)//2, y, tag, FONT_LG, GREEN)

    y += 50
    url = "github.com/Deja922/Deja"
    draw_text(d, cx - text_w(url, FONT_MD)//2, y, url, FONT_MD, DIM)

    return img

# ── Assemble GIF ──────────────────────────────────────────────────────────────

def main():
    print("Generating frames...")
    frames = []
    durations = []

    # Intro (4 s)
    frames.append(make_intro())
    durations.append(4000)

    # 20 rounds (2.5 s each)
    for r in range(1, 21):
        print(f"  Round {r}/20", end="\r")
        frames.append(make_round_frame(r))
        durations.append(2500)

    # Final (6 s)
    frames.append(make_final())
    durations.append(6000)

    print("\nSaving demo.gif...")
    out = "demo.gif"
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=durations,
        optimize=False,
    )
    size_mb = os.path.getsize(out) / 1024 / 1024
    print(f"Done: {out}  ({size_mb:.2f} MB, {len(frames)} frames)")

if __name__ == "__main__":
    main()
