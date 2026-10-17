/**
 * Cheap, deterministic message classifiers that run before retrieval / the AI call:
 * small talk, prompt-injection attempts and clearly off-topic requests.
 * All of them are conservative: when unsure they return null and the normal
 * retrieval + AI flow handles the message.
 */

export type SmallTalkIntent = 'greeting' | 'identity' | 'thanks' | 'farewell' | 'ack';

/** Lowercase, NFKC, punctuation/emoji stripped, whitespace collapsed. Keeps letters/marks/digits of any script. */
export function normalizeMessage(message: string): string {
  return message
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Multi-word phrases are joined with "_" before word classification.
const PHRASES: [RegExp, string][] = [
  [/\bthank (you|u|yu)\b/g, 'thank_you'],
  [/\bgood (morning|afternoon|evening|day)\b/g, 'good_morning'],
  [/\bgood ?night\b/g, 'good_night'],
  [/\bgood ?bye\b/g, 'goodbye'],
  [/\bbye bye\b/g, 'bye'],
  [/\bsee (you|ya|u)( later| soon| again| tomorrow)?\b/g, 'see_you'],
  [/\btalk (to you )?(later|soon)\b/g, 'see_you'],
  [/\btake care\b/g, 'take_care'],
  [/\bhave a (nice|good|great) (day|one|evening|night)\b/g, 'take_care'],
  [/\bthats all( for now)?\b/g, 'thats_all'],
  [/\bnothing else\b/g, 'thats_all'],
  [/\bgot it\b/g, 'got_it'],
  [/\bsounds good\b/g, 'got_it'],
  [/\bmakes sense\b/g, 'got_it'],
  [/\b(theek|thik|thick) (hai|he|h)\b/g, 'theek_hai'],
  [/ठीक है/g, 'theek_hai'],
  [/\bno problem\b/g, 'got_it'],
];

const GREETING_WORDS = new Set(
  'hi hii hiii hiiii hello helo hello hellooo hey heyy heya hiya yo hola namaste namaskar namaskaram vanakkam salaam salam assalamualaikum hai howdy greetings gm good_morning bonjour hallo ola olá oi नमस्ते नमस्कार'.split(' '),
);
const THANKS_WORDS = new Set(
  'thanks thank thank_you thx thnx thanx thankyou ty tysm shukriya shukria dhanyavaad dhanyavad dhanyawad gracias merci danke obrigado obrigada धन्यवाद शुक्रिया appreciated appreciate'.split(' '),
);
const FAREWELL_WORDS = new Set('bye byee byeee goodbye see_you cya take_care good_night gn ttyl alvida tata adios ciao thats_all अलविदा'.split(' '));
const ACK_WORDS = new Set(
  'ok okay okk okkk okie okey k kk cool got_it alright allright sure fine great nice perfect awesome understood noted hmm hm hmmm achha accha acha theek_hai wow oh ohh good excellent super amazing lovely right'.split(' '),
);
const FILLER_WORDS = new Set(
  'so much a lot very bro buddy man dude ji bhai sir maam madam dear friend again for the help info information your you u and then now there all everyone guys team chalo bot assistant for_now its it was that is'.split(' '),
);

const IDENTITY_PATTERNS: RegExp[] = [
  /^(who|what) (are|r) (you|u|ya)( exactly| actually| really)?$/,
  /^(who|what) is this( bot| chat| assistant| chatbot)?$/,
  /^(are|r) (you|u) (a |an )?(bot|robot|human|real|real person|real human|ai|person|machine|chatbot|live agent|agent)$/,
  /^(whats|what is) (your|ur) name$/,
  /^(your|ur) name$/,
  /^who (am i|i am) (talking|speaking|chatting) (to|with)$/,
  /^(what|how) (can|could) (you|u) (do|help)( me| us)?( with)?( for me)?$/,
  /^what (can|should) i ask( you)?$/,
  /^what do (you|u) know( about)?$/,
  /^(can you |could you |please )?help( me)?( please| pls| plz)?$/,
  /^i need (some )?help$/,
  /^(introduce yourself|tell me about yourself)$/,
  /^(aap|ap|tum|tu) (kaun|kon|koun) (ho|hai|hain|h|hoon)$/,
  /^(aap|ap|tum) kya kar sakte (ho|hain|hai|h)$/,
  /^(tumhara|aapka|apka|tera) naam kya (hai|h)$/,
  /^(आप|तुम) कौन (हो|हैं|है)$/,
  /^(आप|तुम) क्या कर सकते (हो|हैं)$/,
  /^quien eres( tu)?$/,
  /^quién eres( tú)?$/,
  /^que puedes hacer$/,
  /^qué puedes hacer$/,
  /^qui (es tu|êtes vous|etes vous)$/,
  /^wer bist du$/,
  /^quem (é|e) voc(ê|e)$/,
];

/** Strips greeting words (and fillers / the bot or business name) from the start. */
function stripLeadingGreeting(words: string[], nameWords: Set<string>): { rest: string[]; hadGreeting: boolean } {
  let i = 0;
  let hadGreeting = false;
  while (i < words.length && (GREETING_WORDS.has(words[i]) || ((hadGreeting || i > 0) && (FILLER_WORDS.has(words[i]) || nameWords.has(words[i]))))) {
    if (GREETING_WORDS.has(words[i])) hadGreeting = true;
    i++;
  }
  return hadGreeting ? { rest: words.slice(i), hadGreeting } : { rest: words, hadGreeting };
}

export interface SmallTalkOptions {
  botName?: string;
  businessName?: string;
  /** Last assistant message: an "ok"/"sure" right after a question is an answer, not small talk. */
  lastAssistantMessage?: string;
}

/** Classifies short social messages. Returns null for anything that might be a real question. */
export function detectSmallTalk(message: string, opts: SmallTalkOptions = {}): SmallTalkIntent | null {
  if (message.length > 80) return null;
  let norm = normalizeMessage(message);
  if (!norm) return null;
  for (const [re, rep] of PHRASES) norm = norm.replace(re, rep);
  const nameWords = new Set(normalizeMessage(`${opts.botName ?? ''} ${opts.businessName ?? ''}`).split(' ').filter((w) => w.length > 1));
  const words = norm.split(' ');
  const { rest, hadGreeting } = stripLeadingGreeting(words, nameWords);
  const restText = rest.join(' ').replace(/_/g, ' ');
  if (rest.length && IDENTITY_PATTERNS.some((re) => re.test(restText))) return 'identity';

  let greeting = hadGreeting;
  let thanks = false;
  let farewell = false;
  let ack = false;
  for (const w of rest) {
    if (GREETING_WORDS.has(w)) greeting = true;
    else if (THANKS_WORDS.has(w)) thanks = true;
    else if (FAREWELL_WORDS.has(w)) farewell = true;
    else if (ACK_WORDS.has(w)) ack = true;
    else if (FILLER_WORDS.has(w) || nameWords.has(w)) continue;
    else return null; // a content word: not small talk
  }
  if (farewell) return 'farewell';
  if (thanks) return 'thanks';
  if (ack) {
    if (opts.lastAssistantMessage && /\?\s*$/.test(opts.lastAssistantMessage.trim().split('\n').filter(Boolean).pop() ?? '')) return null;
    return 'ack';
  }
  if (greeting) return 'greeting';
  return null;
}

// --- Prompt injection --------------------------------------------------------

const INJECTION_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'ignore_instructions', re: /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|initial|original|system|these|those|pichle|upar)\b.{0,30}\b(instructions?|rules|prompts?|directions|guidelines|constraints)\b/i },
  { id: 'system_prompt', re: /\b(system|initial|hidden|original|developer)\s*(prompt|instructions)\b/i },
  { id: 'reveal_instructions', re: /\b(print|show|reveal|repeat|display|output|leak|dump|share|tell me|give me|what are|whats|what is)\b.{0,25}\b(your|ur)\s+(instructions|prompt|configuration|config|system rules)\b(?!\s+(for|on|to|about|regarding)\b)/i },
  { id: 'role_override', re: /\b(you are|youre|you're|u r|ur) now (a |an |my |the |in )?(dan|unrestricted|unfiltered|uncensored|jailbroken|evil|developer|admin|root|chatgpt|gpt|free from|no longer|not bound|(developer|god|dan) mode)\b/i },
  { id: 'role_override', re: /\bfrom now on,? (you|u) (are|will be|must be|act as)\b|\bact as an? (unrestricted|unfiltered|uncensored|jailbroken|evil)\b/i },
  { id: 'jailbreak', re: /\bDAN\b/ },
  { id: 'jailbreak', re: /\b(jailbreak|jail-break|developer mode|do anything now|god mode|sudo mode)\b/i },
  { id: 'secrets', re: /\b(your|ur|the bots?|the systems?)\s+(api|secret|private|openai|anthropic|llm|model)[\s_-]*(keys?|tokens?)\b/i },
  { id: 'secrets', re: /\b(print|show|reveal|dump|leak|list|give me)\b.{0,15}\b(env(ironment)? variables?|\.env)\b/i },
  { id: 'delimiters', re: /<\/?\s*(system|knowledge|visitor_message|owner_instructions)\s*>|\[\/?INST\]|<\|im_(start|end)\|>|###\s*(instruction|system)/i },
];

/** Returns the id of the matched injection pattern, or null. */
export function detectInjection(message: string): string | null {
  const m = message.normalize('NFKC').slice(0, 2000);
  for (const p of INJECTION_PATTERNS) if (p.re.test(m)) return p.id;
  return null;
}

// --- Clearly off-topic requests ---------------------------------------------

const OFF_TOPIC_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'coding', re: /\b(write|generate|fix|debug)\b\s+(me\s+)?(a |an |some |the |this |my )?(simple |small |quick )?(python|javascript|typescript|java|c\+\+|c#|php|ruby|golang|rust|sql|bash|shell|html|css|regex|js)\b/i },
  { id: 'coding', re: /\b(write|generate|fix|debug)\b\s+(me\s+)?(a |an |some |the |this |my )?(simple |small |quick )?(code|script|program|function|snippet|algorithm)\b/i },
  { id: 'coding', re: /\b(debug|refactor|compile)\b.{0,20}\bcode\b|\bhello world (program|in)\b|\bleetcode\b/i },
  { id: 'homework', re: /\b(solve|calculate|integrate|differentiate)\b.{0,30}\b(equation|integral|derivative|maths?)\b|\bmy homework\b/i },
  { id: 'homework', re: /^\s*(what is|whats|calculate)?\s*\d+(\.\d+)?\s*[-+*/x×÷^]\s*\d+(\.\d+)?\s*\??\s*$/i },
  { id: 'writing', re: /\b(write|compose)\b.{0,15}\b(a |an |me a )?(poem|story|essay|song|lyrics|haiku|limerick)\b/i },
  { id: 'trivia', re: /\b(tell me|know any|say) (a |some )?jokes?\b/i },
  { id: 'trivia', re: /\b(what|which) is the (capital|population|currency|national (animal|bird|flower|language)) of\b/i },
  { id: 'trivia', re: /\bcapital (city )?of (france|india|germany|china|japan|usa|america|england|uk|spain|italy|russia|australia|canada|brazil|[a-z]+stan)\b/i },
  { id: 'trivia', re: /\bwho (is|was) the (current )?(president|prime minister|king|queen) of\b/i },
  { id: 'trivia', re: /\b(who (invented|discovered|painted)|who won the (world cup|election|match|ipl)|cricket score|meaning of life)\b|\bwhat time is it\b/i },
];

/**
 * Heuristic for requests that are clearly unrelated to any business website
 * (coding, homework, general trivia). Only consulted when retrieval found nothing
 * relevant, so a coding school's "python course" questions are never blocked.
 */
export function detectOffTopic(message: string): string | null {
  const m = message.normalize('NFKC').slice(0, 500);
  for (const p of OFF_TOPIC_PATTERNS) if (p.re.test(m)) return p.id;
  return null;
}

// --- Reply language ----------------------------------------------------------

export type ReplyLanguage = 'en' | 'hi' | 'hinglish' | 'es' | 'fr' | 'de' | 'pt' | 'ar' | 'bn' | 'ta' | 'te' | 'mr' | 'gu' | 'pa';

const HINGLISH_MARKERS = /\b(hai|kya|kaise|kaun|kon|aap|ap|tum|mujhe|chahiye|shukriya|shukria|dhanyavaad|dhanyavad|dhanyawad|achha|accha|acha|theek|thik|alvida|karo|kare|karna|nahi|nahin|haan|bhai|batao|bataiye|sakte)\b/i;
const SPANISH = /\b(hola|gracias|adios|adiós|quien|quién|eres|puedes|buenos|buenas)\b/i;
const FRENCH = /\b(bonjour|merci|salut|qui|êtes|etes|vous|au revoir)\b/i;
const GERMAN = /\b(hallo|danke|tschüss|tschuss|wer bist|guten)\b/i;
const PORTUGUESE = /\b(olá|ola|obrigado|obrigada|tchau|quem|você|voce)\b/i;

/** Best-effort language for canned replies: script > clear markers > configured language > English. */
export function detectReplyLanguage(message: string, configured: string): ReplyLanguage {
  if (/\p{Script=Devanagari}/u.test(message)) return configured === 'mr' ? 'mr' : 'hi';
  if (/\p{Script=Arabic}/u.test(message)) return 'ar';
  if (/\p{Script=Bengali}/u.test(message)) return 'bn';
  if (/\p{Script=Tamil}/u.test(message)) return 'ta';
  if (/\p{Script=Telugu}/u.test(message)) return 'te';
  if (/\p{Script=Gujarati}/u.test(message)) return 'gu';
  if (/\p{Script=Gurmukhi}/u.test(message)) return 'pa';
  if (HINGLISH_MARKERS.test(message)) return 'hinglish';
  if (SPANISH.test(message)) return 'es';
  if (PORTUGUESE.test(message)) return 'pt';
  if (FRENCH.test(message)) return 'fr';
  if (GERMAN.test(message)) return 'de';
  if (configured && configured !== 'auto') return configured as ReplyLanguage;
  return 'en';
}
