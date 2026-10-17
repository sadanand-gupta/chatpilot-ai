import type { ReplyLanguage, SmallTalkIntent } from '../knowledge/intents';
import type { KnowledgeTopic } from '../knowledge/topics';

/**
 * Canned, localised replies for messages answered without an AI call (small talk,
 * injection attempts, clearly off-topic requests). Languages without a template
 * fall back to English.
 */

interface Templates {
  intro: (bot: string, biz: string) => string;
  helpWith: string;
  askAnything: (biz: string) => string;
  whatToKnow: string;
  thanks: string;
  farewell: (biz: string) => string;
  ack: string;
  injection: (biz: string) => string;
  offTopic: (bot: string, biz: string) => string;
  tellMeAbout: (label: string) => string;
  contact: string;
  pricing: string;
}

const EN: Templates = {
  intro: (bot, biz) => `Hi! I'm ${bot}, the virtual assistant for ${biz}.`,
  helpWith: 'For example, I can help with:',
  askAnything: (biz) => `Ask me anything about ${biz} and I'll do my best to help.`,
  whatToKnow: 'What would you like to know?',
  thanks: "You're welcome! Is there anything else I can help you with?",
  farewell: (biz) => `Thanks for chatting with ${biz}. Have a great day! 👋`,
  ack: 'Great! Let me know if there is anything else you would like to know.',
  injection: (biz) => `Sorry, I can't help with that. I'm here to answer questions about ${biz}.`,
  offTopic: (bot, biz) => `I'm ${bot}, here to help with questions about ${biz}, so I can't help with that one.`,
  tellMeAbout: (l) => `Tell me about ${l}`,
  contact: 'How can I contact you?',
  pricing: 'What are your prices?',
};

const HI: Templates = {
  intro: (bot, biz) => `नमस्ते! मैं ${bot} हूँ, ${biz} का वर्चुअल असिस्टेंट।`,
  helpWith: 'उदाहरण के लिए, मैं इनमें मदद कर सकता हूँ:',
  askAnything: (biz) => `${biz} के बारे में कुछ भी पूछिए, मैं मदद करने की पूरी कोशिश करूँगा।`,
  whatToKnow: 'आप क्या जानना चाहेंगे?',
  thanks: 'आपका स्वागत है! क्या मैं किसी और चीज़ में आपकी मदद कर सकता हूँ?',
  farewell: (biz) => `${biz} से बात करने के लिए धन्यवाद। आपका दिन शुभ हो! 👋`,
  ack: 'बढ़िया! अगर आप कुछ और जानना चाहें तो बताइए।',
  injection: (biz) => `माफ़ कीजिए, मैं इसमें मदद नहीं कर सकता। मैं ${biz} से जुड़े सवालों के जवाब देने के लिए हूँ।`,
  offTopic: (bot, biz) => `मैं ${bot} हूँ और ${biz} से जुड़े सवालों में मदद करता हूँ, इसलिए इसमें मदद नहीं कर पाऊँगा।`,
  tellMeAbout: (l) => `${l} के बारे में बताइए`,
  contact: 'मैं आपसे कैसे संपर्क करूँ?',
  pricing: 'आपकी कीमतें क्या हैं?',
};

const HINGLISH: Templates = {
  intro: (bot, biz) => `Namaste! Main ${bot} hoon, ${biz} ka virtual assistant.`,
  helpWith: 'Jaise, main inme madad kar sakta hoon:',
  askAnything: (biz) => `${biz} ke baare mein kuch bhi poochiye, main poori madad karunga.`,
  whatToKnow: 'Aap kya jaanna chahenge?',
  thanks: 'Aapka swagat hai! Kya main aur kisi cheez mein madad kar sakta hoon?',
  farewell: (biz) => `${biz} se baat karne ke liye dhanyavaad. Aapka din shubh ho! 👋`,
  ack: 'Badhiya! Kuch aur jaanna ho toh bataiye.',
  injection: (biz) => `Maaf kijiye, main ismein madad nahi kar sakta. Main ${biz} se jude sawaalon ke jawaab deta hoon.`,
  offTopic: (bot, biz) => `Main ${bot} hoon aur ${biz} se jude sawaalon mein madad karta hoon, isliye ismein madad nahi kar paunga.`,
  tellMeAbout: (l) => `${l} ke baare mein bataiye`,
  contact: 'Aapse contact kaise karein?',
  pricing: 'Aapki pricing kya hai?',
};

const ES: Templates = {
  intro: (bot, biz) => `¡Hola! Soy ${bot}, el asistente virtual de ${biz}.`,
  helpWith: 'Por ejemplo, puedo ayudarte con:',
  askAnything: (biz) => `Pregúntame lo que quieras sobre ${biz}.`,
  whatToKnow: '¿Qué te gustaría saber?',
  thanks: '¡De nada! ¿Hay algo más en lo que pueda ayudarte?',
  farewell: (biz) => `Gracias por escribir a ${biz}. ¡Que tengas un buen día! 👋`,
  ack: '¡Perfecto! Avísame si quieres saber algo más.',
  injection: (biz) => `Lo siento, no puedo ayudar con eso. Estoy aquí para responder preguntas sobre ${biz}.`,
  offTopic: (bot, biz) => `Soy ${bot} y ayudo con preguntas sobre ${biz}, así que no puedo ayudar con eso.`,
  tellMeAbout: (l) => `Cuéntame sobre ${l}`,
  contact: '¿Cómo puedo contactarles?',
  pricing: '¿Cuáles son sus precios?',
};

const FR: Templates = {
  intro: (bot, biz) => `Bonjour ! Je suis ${bot}, l'assistant virtuel de ${biz}.`,
  helpWith: 'Par exemple, je peux vous aider avec :',
  askAnything: (biz) => `Posez-moi vos questions sur ${biz}.`,
  whatToKnow: 'Que souhaitez-vous savoir ?',
  thanks: 'Avec plaisir ! Puis-je vous aider avec autre chose ?',
  farewell: (biz) => `Merci d'avoir contacté ${biz}. Bonne journée ! 👋`,
  ack: "Parfait ! N'hésitez pas si vous avez d'autres questions.",
  injection: (biz) => `Désolé, je ne peux pas vous aider avec cela. Je suis là pour répondre à vos questions sur ${biz}.`,
  offTopic: (bot, biz) => `Je suis ${bot} et je réponds aux questions sur ${biz}, je ne peux donc pas vous aider avec cela.`,
  tellMeAbout: (l) => `Parlez-moi de ${l}`,
  contact: 'Comment vous contacter ?',
  pricing: 'Quels sont vos tarifs ?',
};

const DE: Templates = {
  intro: (bot, biz) => `Hallo! Ich bin ${bot}, der virtuelle Assistent von ${biz}.`,
  helpWith: 'Ich kann Ihnen zum Beispiel helfen bei:',
  askAnything: (biz) => `Fragen Sie mich alles über ${biz}.`,
  whatToKnow: 'Was möchten Sie wissen?',
  thanks: 'Gern geschehen! Kann ich sonst noch helfen?',
  farewell: (biz) => `Danke für Ihre Nachricht an ${biz}. Einen schönen Tag noch! 👋`,
  ack: 'Super! Melden Sie sich, wenn Sie noch etwas wissen möchten.',
  injection: (biz) => `Dabei kann ich leider nicht helfen. Ich beantworte Fragen zu ${biz}.`,
  offTopic: (bot, biz) => `Ich bin ${bot} und helfe bei Fragen zu ${biz}, dabei kann ich leider nicht helfen.`,
  tellMeAbout: (l) => `Erzählen Sie mir mehr über ${l}`,
  contact: 'Wie kann ich Sie kontaktieren?',
  pricing: 'Was kostet es?',
};

const PT: Templates = {
  intro: (bot, biz) => `Olá! Eu sou ${bot}, o assistente virtual da ${biz}.`,
  helpWith: 'Por exemplo, posso ajudar com:',
  askAnything: (biz) => `Pergunte o que quiser sobre ${biz}.`,
  whatToKnow: 'O que você gostaria de saber?',
  thanks: 'De nada! Posso ajudar com mais alguma coisa?',
  farewell: (biz) => `Obrigado por falar com ${biz}. Tenha um ótimo dia! 👋`,
  ack: 'Ótimo! Se quiser saber mais alguma coisa, é só perguntar.',
  injection: (biz) => `Desculpe, não posso ajudar com isso. Estou aqui para responder perguntas sobre ${biz}.`,
  offTopic: (bot, biz) => `Eu sou ${bot} e ajudo com perguntas sobre ${biz}, então não posso ajudar com isso.`,
  tellMeAbout: (l) => `Fale sobre ${l}`,
  contact: 'Como entro em contato?',
  pricing: 'Quais são os preços?',
};

const TEMPLATES: Partial<Record<ReplyLanguage, Templates>> = { en: EN, hi: HI, mr: HI, hinglish: HINGLISH, es: ES, fr: FR, de: DE, pt: PT };

export function templates(lang: ReplyLanguage): Templates {
  return TEMPLATES[lang] ?? EN;
}

export interface CannedContext {
  lang: ReplyLanguage;
  botName: string;
  businessName: string;
  welcomeMessage: string;
  /** What the knowledge covers (labels), best first. */
  topics: KnowledgeTopic[];
  /** Owner-configured suggested questions (preferred for examples/suggestions). */
  suggestedQuestions: string[];
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** 2–3 tappable follow-ups from configured suggested questions, FAQ questions or topic labels. */
export function topicSuggestions(ctx: Pick<CannedContext, 'lang' | 'topics' | 'suggestedQuestions'>, max = 3): string[] {
  const t = templates(ctx.lang);
  const out: string[] = [];
  const add = (s: string) => {
    const v = s.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  for (const q of ctx.suggestedQuestions) if (out.length < max) add(q);
  for (const topic of ctx.topics) {
    if (out.length >= max) break;
    if (topic.kind === 'faq') add(topic.label);
    else if (/contact|support|help/i.test(topic.label)) add(t.contact);
    else if (/pric|plan|fee|cost/i.test(topic.label)) add(t.pricing);
    else add(t.tellMeAbout(lowerFirst(topic.label)));
  }
  return out.slice(0, max);
}

function examples(ctx: CannedContext): string[] {
  const list = ctx.suggestedQuestions.length ? ctx.suggestedQuestions : ctx.topics.map((x) => x.label);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 4);
}

function withExamples(lead: string, ctx: CannedContext): string {
  const t = templates(ctx.lang);
  const ex = examples(ctx);
  if (!ex.length) return `${lead} ${t.askAnything(ctx.businessName)}`;
  return `${lead} ${t.helpWith}\n\n${ex.map((e) => `- ${e}`).join('\n')}\n\n${t.whatToKnow}`;
}

export function smallTalkReply(intent: SmallTalkIntent, ctx: CannedContext): string {
  const t = templates(ctx.lang);
  switch (intent) {
    case 'greeting':
      return ctx.welcomeMessage;
    case 'identity':
      return withExamples(t.intro(ctx.botName, ctx.businessName), ctx);
    case 'thanks':
      return t.thanks;
    case 'farewell':
      return t.farewell(ctx.businessName);
    case 'ack':
      return t.ack;
  }
}

export function injectionReply(ctx: CannedContext): string {
  return withExamples(templates(ctx.lang).injection(ctx.businessName), ctx);
}

export function offTopicReply(ctx: CannedContext): string {
  return withExamples(templates(ctx.lang).offTopic(ctx.botName, ctx.businessName), ctx);
}
