// The Advanced Export form is grouped into rounded cards (Delivery, Video, Audio, Quality, Advanced), each a title
// over rows (label left, value right). A card hides itself when every row in it is hidden (CSS :has), so the groups
// follow the chosen format without any script.
import { el, setText } from './dom';
import { t } from './i18n';

export function exportCard(title: string, ...rows: HTMLElement[]): HTMLElement {
  const card = el<HTMLElement>('<section class="fm-ex-card"><h3 class="fm-ex-card-title"></h3></section>');
  setText(card.firstElementChild as HTMLElement, t(title));
  card.append(...rows);
  return card;
}
