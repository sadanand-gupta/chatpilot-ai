import * as cheerio from 'cheerio';

/**
 * schema.org JSON-LD -> readable text. Many sites (including client-rendered
 * ones) ship their FAQ, prices, address and opening hours as structured data;
 * this turns the useful types into short lines a chatbot can quote:
 *   FAQPage -> "Q: … / A: …", Offer -> "Name — 99 INR", LocalBusiness -> address, phone, hours…
 * Unknown or purely technical types (WebSite, BreadcrumbList, ImageObject…) are ignored.
 */

export interface StructuredItem {
  heading?: string;
  lines: string[];
  /** Set for FAQ entries (lets the caller skip questions already visible on the page). */
  question?: string;
}

type Obj = Record<string, unknown>;

const MAX_BLOCK_CHARS = 300_000;
const MAX_ENTITIES = 60;
const MAX_ITEMS = 120;
const MAX_LINE = 1200;
const MAX_TOTAL_CHARS = 20_000;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function clean(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  let s = v;
  if (/[<&]/.test(s)) {
    // Answers often hold HTML: drop tags (as spaces) and decode entities.
    s = cheerio.load(`<b>${s.replace(/<[^>]*>/g, ' ')}</b>`)('b').text();
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, MAX_LINE) : undefined;
}

const nameOf = (v: unknown): string | undefined => (typeof v === 'string' ? clean(v) : isObj(v) ? clean(v.name) : undefined);
const namesOf = (v: unknown, max = 20): string | undefined => {
  const list = [...new Set(arr(v).map(nameOf).filter((x): x is string => !!x))].slice(0, max);
  return list.length ? list.join(', ') : undefined;
};
const typesOf = (o: Obj): string[] => arr(o['@type']).filter((t): t is string => typeof t === 'string').map((t) => t.split(/[/#:]/).pop() ?? t);
const isUrlish = (s: string) => /^https?:\/\//i.test(s);

const FAQ_TYPES = /^(FAQPage|QAPage)$/;
const PRODUCT_TYPES = /^(Product|ProductGroup|IndividualProduct|ProductModel|Car|Vehicle|Motorcycle|MenuItem)$/;
const OFFER_TYPES = /^(Offer|AggregateOffer)$/;
const SERVICE_TYPES = /^(Service|FinancialProduct|LoanOrCredit|BankAccount|SoftwareApplication|WebApplication|MobileApplication|VideoGame|Course|CourseInstance|Book|Menu|Trip|TouristTrip)$/;
const EVENT_TYPES = /Event$/;
const ORG_TYPES =
  /(Organization|Organisation|Business|Corporation|Store|Shop|Restaurant|Cafe|CafeOrCoffeeShop|Bakery|BarOrPub|Hotel|LodgingBusiness|Resort|Clinic|Dentist|Physician|Hospital|Pharmacy|Optician|MedicalBusiness|ProfessionalService|LegalService|Attorney|Notary|Agency|School|College|University|Preschool|Library|Museum|Gym|HealthClub|ExerciseGym|SportsActivityLocation|Salon|Spa|DaySpa|AutoRepair|AutoDealer|Dealer|Contractor|Plumber|Electrician|Locksmith|HVACBusiness|RealEstateAgent|NGO|Place|TouristAttraction|Brewery|Winery|FoodEstablishment|EntertainmentBusiness|ChildCare|AnimalShelter|VeterinaryCare)$/;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface OfferParts {
  name?: string;
  price?: string;
  description?: string;
}

function offerParts(o: Obj): OfferParts | undefined {
  const spec = arr(o.priceSpecification).find(isObj);
  const currency = clean(o.priceCurrency) ?? (spec ? clean(spec.priceCurrency) : undefined) ?? '';
  let price: string | undefined;
  const p = clean(o.price) ?? (spec ? clean(spec.price) : undefined);
  if (p !== undefined) {
    price = Number(p) === 0 && /^[\d.,\s]+$/.test(p) ? 'Free' : `${p} ${currency}`.trim();
  } else {
    const lo = clean(o.lowPrice);
    const hi = clean(o.highPrice);
    if (lo || hi) price = `${lo && hi && lo !== hi ? `${lo}–${hi}` : (lo ?? hi)} ${currency}`.trim();
  }
  const unit = spec ? (clean(spec.unitText) ?? clean(spec.billingDuration)) : undefined;
  if (price && unit && price !== 'Free') price += ` / ${unit.toLowerCase()}`;
  const name = clean(o.name) ?? nameOf(o.itemOffered);
  const description = clean(o.description);
  if (!price && !description) return undefined;
  return { name, price, description };
}

function offerLine(parts: OfferParts, fallbackName?: string): string {
  const name = parts.name ?? fallbackName;
  const head = name && parts.price ? `${name} — ${parts.price}` : parts.price ? `Price: ${parts.price}` : (name ?? '');
  return parts.description && parts.description !== name ? `${head}${head ? ': ' : ''}${parts.description}` : head;
}

function offersLines(v: unknown, fallbackName?: string): string[] {
  const out: string[] = [];
  for (const o of arr(v).slice(0, 40)) {
    if (!isObj(o)) continue;
    const parts = offerParts(o);
    if (parts) out.push(offerLine(parts, fallbackName));
    // AggregateOffer with nested offers.
    if (o.offers) out.push(...offersLines(o.offers, fallbackName));
  }
  return out.filter(Boolean);
}

function addressText(a: unknown): string | undefined {
  if (typeof a === 'string') return clean(a);
  if (!isObj(a)) return undefined;
  if (isObj(a.address) || typeof a.address === 'string') return addressText(a.address);
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
    .map((x) => nameOf(x))
    .filter((x): x is string => !!x);
  return parts.length ? [...new Set(parts)].join(', ') : undefined;
}

function hoursText(o: Obj): string | undefined {
  const plain = arr(o.openingHours).map(clean).filter((x): x is string => !!x);
  if (plain.length) return plain.join('; ');
  const specs = arr(o.openingHoursSpecification)
    .filter(isObj)
    .map((s) => {
      const days = arr(s.dayOfWeek)
        .map((d) => (typeof d === 'string' ? d.split('/').pop() : nameOf(d)))
        .filter(Boolean)
        .join(', ');
      const opens = clean(s.opens);
      const closes = clean(s.closes);
      const time = opens && closes ? (opens === closes && /^0?0:00/.test(opens) ? 'closed' : `${opens}–${closes}`) : (opens ?? closes);
      return [days, time].filter(Boolean).join(': ');
    })
    .filter(Boolean);
  return specs.length ? specs.join('; ') : undefined;
}

function ratingText(v: unknown): string | undefined {
  if (!isObj(v)) return undefined;
  const value = clean(v.ratingValue);
  if (!value) return undefined;
  const best = clean(v.bestRating) ?? '5';
  const count = clean(v.reviewCount) ?? clean(v.ratingCount);
  return `Rating: ${value}/${best}${count ? ` (${count} reviews)` : ''}`;
}

function pushIf(lines: string[], label: string, value: string | undefined) {
  if (value && !isUrlish(value)) lines.push(`${label}: ${value}`);
}

function faqItems(o: Obj): StructuredItem[] {
  const out: StructuredItem[] = [];
  for (const q of arr(o.mainEntity)) {
    if (!isObj(q)) continue;
    const question = clean(q.name) ?? clean(q.text);
    const ans = arr(q.acceptedAnswer).find(isObj) ?? arr(q.suggestedAnswer).find(isObj);
    const answer = ans ? (clean(ans.text) ?? clean(ans.name)) : undefined;
    if (question && answer) out.push({ heading: question, lines: [`Q: ${question}`, `A: ${answer}`], question });
  }
  return out;
}

function productItem(o: Obj): StructuredItem | undefined {
  const name = clean(o.name);
  const lines: string[] = [];
  const desc = clean(o.description);
  if (desc) lines.push(desc);
  pushIf(lines, 'Brand', nameOf(o.brand));
  for (const parts of arr(o.offers).filter(isObj).map(offerParts)) {
    if (!parts) continue;
    lines.push(parts.name && parts.name !== name ? offerLine(parts) : offerLine({ ...parts, name: undefined }));
  }
  const rating = ratingText(o.aggregateRating);
  if (rating) lines.push(rating);
  return lines.length ? { heading: name, lines } : undefined;
}

function serviceItem(o: Obj): StructuredItem | undefined {
  const name = clean(o.name);
  const lines: string[] = [];
  const desc = clean(o.description);
  if (desc) lines.push(desc);
  pushIf(lines, 'Services', namesOf(o.serviceType));
  const offers = offersLines(o.offers, name);
  for (const l of offers) lines.push(l === `${name}` ? l : l.startsWith(`${name} — `) ? `Price: ${l.slice(name!.length + 3)}` : l);
  pushIf(lines, 'Price range', clean(o.priceRange));
  pushIf(lines, 'Area served', namesOf(o.areaServed));
  const rating = ratingText(o.aggregateRating);
  if (rating) lines.push(rating);
  return lines.length ? { heading: name, lines } : undefined;
}

function eventItem(o: Obj): StructuredItem | undefined {
  const name = clean(o.name);
  const lines: string[] = [];
  const start = clean(o.startDate);
  const end = clean(o.endDate);
  if (start) lines.push(`When: ${start}${end && end !== start ? ` – ${end}` : ''}`);
  const loc = arr(o.location).find(isObj);
  if (loc) pushIf(lines, 'Where', [clean(loc.name), addressText(loc.address)].filter(Boolean).join(', ') || undefined);
  const desc = clean(o.description);
  if (desc) lines.push(desc);
  lines.push(...offersLines(o.offers));
  return lines.length ? { heading: name, lines } : undefined;
}

function orgItem(o: Obj): StructuredItem | undefined {
  const name = clean(o.name);
  const lines: string[] = [];
  const desc = clean(o.description);
  if (desc) lines.push(desc);
  for (const a of arr(o.address).slice(0, 5)) pushIf(lines, 'Address', addressText(a));
  pushIf(lines, 'Phone', namesOf(o.telephone, 5));
  pushIf(lines, 'Email', namesOf(o.email, 5));
  pushIf(lines, 'Opening hours', hoursText(o));
  pushIf(lines, 'Price range', clean(o.priceRange));
  pushIf(lines, 'Services', namesOf(o.serviceType));
  pushIf(lines, 'Areas served', namesOf(o.areaServed));
  for (const cp of arr(o.contactPoint).filter(isObj).slice(0, 5)) {
    const how = [namesOf(cp.telephone, 3), namesOf(cp.email, 3)].filter(Boolean).join(', ');
    if (how) lines.push(`${cap(clean(cp.contactType) ?? 'contact')}: ${how}`);
  }
  pushIf(lines, 'Founded', clean(o.foundingDate));
  pushIf(lines, 'Founder', namesOf(o.founder, 5));
  lines.push(...offersLines(o.makesOffer));
  const catalog = arr(o.hasOfferCatalog).find(isObj);
  if (catalog) {
    const names = arr(catalog.itemListElement)
      .map((e) => (isObj(e) ? (nameOf(e.itemOffered) ?? nameOf(e)) : undefined))
      .filter(Boolean)
      .slice(0, 30);
    if (names.length) lines.push(`Offers: ${names.join(', ')}`);
  }
  const rating = ratingText(o.aggregateRating);
  if (rating) lines.push(rating);
  return lines.length ? { heading: name, lines } : undefined;
}

function render(o: Obj, out: StructuredItem[], depth = 0): void {
  if (depth > 3 || out.length >= MAX_ITEMS) return;
  const types = typesOf(o);
  const is = (re: RegExp) => types.some((t) => re.test(t));
  let item: StructuredItem | undefined;
  if (is(FAQ_TYPES)) {
    out.push(...faqItems(o));
    return;
  }
  if (is(/^ItemList$/) || is(/^OfferCatalog$/)) {
    for (const e of arr(o.itemListElement).slice(0, 50)) {
      if (!isObj(e)) continue;
      const inner = isObj(e.item) ? e.item : e;
      if (typesOf(inner).length) render(inner, out, depth + 1);
    }
    return;
  }
  if (is(PRODUCT_TYPES)) item = productItem(o);
  else if (is(OFFER_TYPES)) {
    const lines = offersLines(o);
    item = lines.length ? { lines } : undefined;
  } else if (is(EVENT_TYPES)) item = eventItem(o);
  else if (is(SERVICE_TYPES)) item = serviceItem(o);
  else if (is(ORG_TYPES)) item = orgItem(o);
  if (item) out.push(item);
}

/** Converts the JSON-LD blocks of a page into readable items (deduplicated, bounded). */
export function jsonLdToItems(blocks: string[]): StructuredItem[] {
  const entities: Obj[] = [];
  const collect = (v: unknown, depth = 0) => {
    if (depth > 3 || entities.length >= MAX_ENTITIES) return;
    if (Array.isArray(v)) v.forEach((x) => collect(x, depth + 1));
    else if (isObj(v)) {
      if (Array.isArray(v['@graph'])) collect(v['@graph'], depth + 1);
      if (v['@type']) entities.push(v);
    }
  };
  for (const raw of blocks) {
    if (raw.length > MAX_BLOCK_CHARS) continue;
    const src = raw.trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\*<!\[CDATA\[\*\/|\/\*\]\]>\*\/$/g, '');
    try {
      collect(JSON.parse(src));
    } catch {
      /* invalid JSON-LD is common; skip it */
    }
  }
  const out: StructuredItem[] = [];
  for (const e of entities) render(e, out);
  const seen = new Set<string>();
  let total = 0;
  return out.filter((it) => {
    const key = `${it.heading ?? ''}\n${it.lines.join('\n')}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    total += key.length;
    return total <= MAX_TOTAL_CHARS;
  });
}
