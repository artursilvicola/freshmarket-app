import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  Home, Building2, Store, Send, Tag, Plus, Clock, Edit, CheckCircle,
  X, ArrowLeft, Search, Info, AlertTriangle, Bot, Leaf, Award, Users,
  Calendar, Phone, Mail, User, Sliders, FileText, Layers, Zap, PlusCircle,
  Package, ExternalLink, Sparkles, RefreshCw, Eye, Upload, ShieldCheck,
  Filter, Globe, Star, TrendingUp, CreditCard, ChevronDown, ChevronUp,
  RotateCcw, GripVertical, Heart, Wallet, Bell, Activity, Settings, Lock, Unlock,
  MessageCircle, MessageSquare, Send as SendIcon
} from "lucide-react";
import {
  loadLegacyOffers, upsertLegacyOffer, bulkUpsertLegacyOffers, deleteLegacyOffer,
  loadLegacySends, upsertLegacySend, bulkUpsertLegacySends, deleteLegacySend,
  // [B2B Round 2.1] Replace localStorage for FM 2026 state
  getCompanies as dbGetCompanies, updateCompany as dbUpdateCompany, bulkUpsertCompanies, saveCompanyContacts as dbSaveCompanyContacts,
  getRetailers as dbGetRetailers, bulkUpsertRetailers,
  createBuyerAccount as dbCreateBuyerAccount,
  adminUpdateBuyerAccount as dbAdminUpdateBuyerAccount, updateOwnBuyerProfile as dbUpdateOwnBuyerProfile,
  updateOwnSupplierProfile as dbUpdateOwnSupplierProfile, changeOwnPassword as dbChangeOwnPassword,
  getFmSettings as dbGetFmSettings, saveFmSettings as dbSaveFmSettings,
  getFmResps as dbGetFmResps, saveFmResp as dbSaveFmResp,
  getFmSchedule as dbGetFmSchedule, saveFmSchedule as dbSaveFmSchedule,
  getAllCompanyTargetRetailers as dbGetAllCompanyTargetRetailers,
  setCompanyTargetRetailers as dbSetCompanyTargetRetailers,
  getFmWishlists as dbGetFmWishlists, saveFmWishlist as dbSaveFmWishlist,
  deleteFmWishlist as dbDeleteFmWishlist,
  getFmLateResps as dbGetFmLateResps, saveFmLateResp as dbSaveFmLateResp,
  deleteFmLateResp as dbDeleteFmLateResp,
  getFmMessages as dbGetFmMessages, saveFmMessage as dbSaveFmMessage,
  markFmMessageRead as dbMarkFmMessageRead,
  generateCompanyDescriptionAI as dbGenerateCompanyDescriptionAI,
  suggestAdminChatReplyAI as dbSuggestAdminChatReplyAI,
  // [B2B Round pipeline-retailer-email-mvp] Wysyłka zbiorcza przez admina
  sendRetailerBatch as dbSendRetailerBatch,
  // [B2B Round supplier-onboarding-access-and-communication]
  notifySupplier as dbNotifySupplier,
  getPendingSupplierCount as dbGetPendingSupplierCount,
  // [B2B Round 5] Per-action save lifecycle helpers
  markLegacySendRead as dbMarkLegacySendRead,
  expireLegacySends14d as dbExpireLegacySends14d,
  refundUnreadExpiredLegacySends as dbRefundUnreadExpiredLegacySends,
  // [B2B Round supplier-FM-UX] Confirm supplier's FM chain selection
  saveFmSelectionConfirmation as dbSaveFmSelectionConfirmation,
  // [B2B Round prod-rollout / faza 2] Real packages/capacity from DB
  getAllCompanyCapacity as dbGetAllCompanyCapacity,
  // [B2B Round prod-rollout / faza 3] PayU integration
  createPayuOrder as dbCreatePayuOrder,
} from "../lib/db";
import SimplePhotoUploader from "../components/SimplePhotoUploader";
import FreshMarketLogo from "../components/FreshMarketLogo";

/* ─────────────── CONSTANTS ─────────────────────────────────────────────── */
const FLAGS  = { AT:"🇦🇹",BE:"🇧🇪",BR:"🇧🇷",BG:"🇧🇬",CL:"🇨🇱",CO:"🇨🇴",CR:"🇨🇷",HR:"🇭🇷",CY:"🇨🇾",CZ:"🇨🇿",DE:"🇩🇪",DK:"🇩🇰",EC:"🇪🇨",EG:"🇪🇬",EE:"🇪🇪",FI:"🇫🇮",FR:"🇫🇷",GR:"🇬🇷",ES:"🇪🇸",NL:"🇳🇱",IE:"🇮🇪",IT:"🇮🇹",KE:"🇰🇪",LV:"🇱🇻",LT:"🇱🇹",LU:"🇱🇺",MD:"🇲🇩",MT:"🇲🇹",MA:"🇲🇦",PE:"🇵🇪",PL:"🇵🇱",PT:"🇵🇹",RO:"🇷🇴",SK:"🇸🇰",SI:"🇸🇮",ZA:"🇿🇦",SE:"🇸🇪",TR:"🇹🇷",UA:"🇺🇦",HU:"🇭🇺" };
const CEMOJI = { owoce:"🍎", warzywa:"🥕", kwiaty:"🌸", zioła:"🌿", inne:"📦" };
// Alfabetyczna lista krajów
const CNAMES = { AT:"Austria",BE:"Belgia",BR:"Brazylia",BG:"Bułgaria",CL:"Chile",CO:"Kolumbia",CR:"Kostaryka",HR:"Chorwacja",CY:"Cypr",CZ:"Czechy",DE:"Niemcy",DK:"Dania",EC:"Ekwador",EG:"Egipt",EE:"Estonia",FI:"Finlandia",FR:"Francja",GR:"Grecja",ES:"Hiszpania",NL:"Holandia",IE:"Irlandia",IT:"Włochy",KE:"Kenia",LV:"Łotwa",LT:"Litwa",LU:"Luksemburg",MD:"Mołdawia",MT:"Malta",MA:"Maroko",PE:"Peru",PL:"Polska",PT:"Portugalia",RO:"Rumunia",SK:"Słowacja",SI:"Słowenia",ZA:"Republika Południowej Afryki",SE:"Szwecja",TR:"Turcja",UA:"Ukraina",HU:"Węgry" };
const CNAMES_SORTED = Object.entries(CNAMES).sort((a,b)=>a[1].localeCompare(b[1],"pl"));
const TYPE_LABELS = { producent:"🌱 Producent", eksporter:"✈ Eksporter", importer:"📥 Importer", firma_handlowa:"🤝 Firma Handlowa", pakowalnia:"📦 Pakowalnia", firma_logistyczna:"🚛 Firma Logistyczna", kooperatywa:"🤲 Kooperatywa", agent:"🔎 Agent/Broker" };

const STATUS_TIPS = {
  pending_moderation: "Propozycja oczekuje na weryfikację przez administratora przed wysyłką do kupca.",
  queued: "Propozycja w kolejce do wysyłki w najbliższym terminie mailingowym.",
  approved: "Propozycja zatwierdzona — zostanie wysłana w zaplanowanym terminie.",
  sent: "Propozycja dostarczona do kupca. Oczekujemy potwierdzenia odczytu (14 dni).",
  read: "Kupiec zapoznał się z propozycją.",
  read_manual: "Kupiec potwierdził zapoznanie się z propozycją.",
  unread_expired: "Propozycja nie została odczytana w ciągu 14 dni. Środki zwrócono na portfel.",
  rejected: "Propozycja odrzucona przez administratora."
};

// [B2B Round prod-rollout / UX] Codex feedback: pełne etykiety zamiast skrótów
// "Dost. · Nieprzecz." — w UI mamy miejsce na pełny tekst, badge i tak był
// nieczytelny. STATUS_TIPS (linia ~60) zostaje aktywne jako title= wszędzie
// gdzie pokazujemy STATUS_MAP.
const STATUS_MAP = {
  queued:             ["W kolejce",                "#ca8a04"],
  pending_moderation: ["Do moderacji",             "#ca8a04"],
  approved:           ["Zatwierdzona",             "#2563eb"],
  rejected:           ["Odrzucona",                "#dc2626"],
  sent:               ["Dostarczona, nieodczytana","#ea580c"],
  opened:             ["Odczytana",                "#7c3aed"],
  read:               ["Odczytana",                "#059669"],
  read_manual:        ["Odczytana ✓",              "#047857"],
  unread_expired:     ["Wygasła, kredyt zwrócony", "#dc2626"],
  refunded:           ["Zwrot kredytu",            "#64748b"],
};

const CTA_MAP = { samples:"Poproś o próbkę", spec:"Poproś o specyfikację", rfq:"Zapytaj o cenę i wolumen", call:"Umów rozmowę", long_term:"Zapytaj o program sezonowy", meet_fm:"Umów spotkanie na Fresh Market" };

const RETAILERS = [
  { id:100, name:"Biedronka",           country:"PL", cats:["owoce","warzywa"],          color:"#dc2626", bg:"#fee2e2", initials:"BIE", buyer:"Monika Wiśniewska",    email:"owoce@biedronka.pl",              phone:"+48 22 123 4500", nextSend:"2026-05-06" },
  { id:101, name:"Lidl Polska",         country:"PL", cats:["owoce","warzywa"],          color:"#1e3a8a", bg:"#dbeafe", initials:"LDL", buyer:"Piotr Zając",           email:"warzywa@lidl.pl",                 phone:"+48 22 987 6543", nextSend:"2026-05-06" },
  { id:102, name:"Kaufland Polska",     country:"PL", cats:["owoce","warzywa"],          color:"#b91c1c", bg:"#fef2f2", initials:"KAU", buyer:"Anna Kowalczyk",        email:"a.kowalczyk@kaufland.pl",         phone:"+48 22 456 7890", nextSend:"2026-05-06" },
  { id:103, name:"Carrefour Polska",    country:"PL", cats:["owoce","warzywa","kwiaty"], color:"#1d4ed8", bg:"#eff6ff", initials:"CAR", buyer:"Marcin Nowak",          email:"m.nowak@carrefour.pl",            phone:"+48 22 345 6789", nextSend:"2026-05-06" },
  { id:104, name:"Auchan Polska",       country:"PL", cats:["owoce","warzywa","kwiaty"], color:"#e11d48", bg:"#fff1f2", initials:"AUC", buyer:"Katarzyna Wróbel",      email:"k.wrobel@auchan.pl",              phone:"+48 22 567 8901", nextSend:"2026-05-06" },
  { id:105, name:"Netto Polska",        country:"DK", cats:["owoce","warzywa"],          color:"#f97316", bg:"#fff7ed", initials:"NET", buyer:"Tomasz Kaczmarek",      email:"t.kaczmarek@netto.pl",            phone:"+48 91 234 5678", nextSend:"2026-05-06" },
  { id:106, name:"Intermarché",         country:"FR", cats:["owoce","warzywa","kwiaty"], color:"#16a34a", bg:"#f0fdf4", initials:"INT", buyer:"Sophie Martin",         email:"s.martin@intermarche.pl",         phone:"+33 1 6677 8899", nextSend:"2026-05-06" },
  { id:107, name:"Dino Polska",         country:"PL", cats:["owoce","warzywa"],          color:"#7c3aed", bg:"#faf5ff", initials:"DIN", buyer:"Michał Adamski",        email:"m.adamski@dino.pl",               phone:"+48 62 345 6789", nextSend:"2026-05-06" },
  { id:108, name:"E.Leclerc",           country:"FR", cats:["owoce","warzywa","kwiaty"], color:"#0369a1", bg:"#e0f2fe", initials:"LEC", buyer:"Jean Dupuis",           email:"j.dupuis@leclerc.fr",             phone:"+33 2 5544 3322", nextSend:"2026-05-06" },
  { id:109, name:"Aldi Polska",         country:"DE", cats:["owoce","warzywa"],          color:"#1e3a5f", bg:"#f1f5f9", initials:"ALD", buyer:"Klaus Weber",           email:"k.weber@aldi.de",                 phone:"+49 208 9977 100", nextSend:"2026-05-06" },
  { id:110, name:"Stokrotka",           country:"PL", cats:["owoce","warzywa"],          color:"#059669", bg:"#ecfdf5", initials:"STK", buyer:"Beata Kowalska",        email:"b.kowalska@stokrotka.pl",         phone:"+48 81 234 5678", nextSend:"2026-05-06" },
  { id:111, name:"Makro Polska",        country:"DE", cats:["owoce","warzywa","kwiaty"], color:"#dc2626", bg:"#fef2f2", initials:"MAK", buyer:"Przemysław Witek",      email:"p.witek@makro.pl",                phone:"+48 22 775 5100", nextSend:"2026-05-06" },
  { id:112, name:"Selgros",             country:"DE", cats:["owoce","warzywa","kwiaty"], color:"#1d4ed8", bg:"#eff6ff", initials:"SEL", buyer:"Dorota Malinowska",     email:"d.malinowska@selgros.pl",         phone:"+48 61 898 7000", nextSend:"2026-05-06" },
  { id:113, name:"Polomarket",          country:"PL", cats:["owoce","warzywa"],          color:"#9333ea", bg:"#fdf4ff", initials:"POL", buyer:"Łukasz Grabowski",      email:"l.grabowski@polomarket.pl",       phone:"+48 22 890 1234", nextSend:"2026-05-06" },
  { id:114, name:"Albert CZ",           country:"CZ", cats:["owoce","warzywa"],          color:"#0891b2", bg:"#ecfeff", initials:"ALB", buyer:"Jana Nováková",         email:"j.novakova@albert.cz",            phone:"+420 2 3456 7890", nextSend:"2026-05-06" },
  { id:115, name:"BILLA CEE",           country:"AT", cats:["owoce","warzywa","kwiaty"], color:"#b91c1c", bg:"#fff1f2", initials:"BIL", buyer:"Stefan Bauer",          email:"s.bauer@billa-cee.com",           phone:"+43 1 6060 9900", nextSend:"2026-05-06" },
  { id:116, name:"Maxima LT",           country:"LT", cats:["owoce","warzywa"],          color:"#d97706", bg:"#fffbeb", initials:"MAX", buyer:"Rasa Kazlauskaitė",     email:"r.kazlauskaitė@maxima.lt",        phone:"+370 5 233 0000", nextSend:"2026-05-06" },
  { id:117, name:"Rimi Baltic",         country:"LV", cats:["owoce","warzywa"],          color:"#dc2626", bg:"#fff1f2", initials:"RIM", buyer:"Andris Kārkliņš",      email:"a.karklins@rimi.lv",              phone:"+371 6733 4455", nextSend:"2026-05-06" },
  { id:118, name:"ATB Market",          country:"UA", cats:["owoce","warzywa"],          color:"#15803d", bg:"#f0fdf4", initials:"ATB", buyer:"Олена Петренко",        email:"o.petrenko@atbmarket.ua",         phone:"+380 56 723 4500", nextSend:"2026-05-06" },
  { id:119, name:"Delikatesy Centrum",  country:"PL", cats:["owoce","warzywa","kwiaty"], color:"#0d9488", bg:"#f0fdfa", initials:"DEL", buyer:"Agnieszka Białek",      email:"a.bialek@eurocash.pl",            phone:"+48 61 334 7770", nextSend:"2026-05-06" },
  { id:120, name:"Spar Polska",         country:"NL", cats:["owoce","warzywa","kwiaty"], color:"#16a34a", bg:"#f0fdf4", initials:"SPA", buyer:"Joost van der Berg",    email:"j.vanderberg@spar.pl",            phone:"+31 20 609 9000", nextSend:"2026-05-06" },
];

const COMPANY_INIT = {
  name:"Food Market", nip:"PL1181976336", country:"PL", city:"Recz",
  phone:"+48 789 464 307", website:"https://2pm.slupsk.pl",
  description:"Food Market – producent i eksporter jabłek deserowych (Gala, Szampion) oraz warzyw gruntowych (marchew, ziemniaki, brokuły). Własna pakowalnia z sortownią optyczną i chłodnią CA 2000 ton. Dostawy retail-ready do sieci handlowych w Polsce i Europie Środkowej.",
  types:["producent","eksporter","pakowalnia"], categories:["owoce","warzywa"],
  products:"jabłka Gala, cukinia, brokuły", seasonality:"IX-II, V-X",
  markets:"CEE, DE, NL", completeness:85, logo:null, pdfs:[],
  contacts:[
    { role:"sales",   name:"Joanna Emilianowicz", position:"Export Manager",  phone:"+48 789 464 307", email:"joanna@i-f.online" },
    { role:"quality", name:"Adam Kowalski",        position:"Quality Manager", phone:"+48 999 111 222", email:"adam@i-f.online" },
  ],
  certs:[
    { type:"GlobalGAP", number:"4056186695431", valid:"2026-11-21" },
    { type:"BRC",       number:"BRC-FM-2024",   valid:"2026-06-12" },
  ],
  pkg:"std_10", pkgExpiry:"2026-12-31",
};

const BUYER_INIT = {
  name:"Anna Nowak", position:"Category Manager", company:"Biedronka",
  email:"anna.nowak@biedronka.pl", phone:"+48 600 100 200", country:"PL", consent:true,
  starred: [],
};

const OFFERS_INIT = [
  /* ── UNICA GROUP — owoce ───────────────────────────────── */
  {
    id:1, supplierId:"sup-s1", product:"Cytrusy mix", variety:"Navel / Satsuma", category:"owoce", subcategory:"cytrusy",
    origin:"ES", region:"Walencja",
    offerType:"Program stały", positioning:"Codzienna półka",
    title:"Cytrusy mix Walencja — pomarańcze + mandarynki, program stały",
    description:"Nasz produkt wyróżnia:\n**Jakość i odmiana-** Pomarańcze Navel klasy I i mandarynki Satsuma — intensywna słodycz, niska kwasowość, łatwe obieranie.\n**Certyfikaty-** GlobalGAP + BRC aktywne.\n**Dostępność-** Cały sezon (październik–marzec), własne sady 800 ha w Walencji.\n**Logistyka-** Transport chłodniczy PL/ES 48h, dostawy retail-ready.",
    size:"65–80 mm", qualityClass:"Klasa I", isBio:false, brix:"min. 11°Bx", colorSpec:"Pomarańcz intensywna, jednolita",
    qualitySpec:"Pomarańcze i mandarynki z własnych sadów Walencji. Sortownia optyczna, brak uszkodzeń mechanicznych. Trwałość 21 dni. Odpady <2%.",
    brand:"Unica Group", saleMode:"Marka producenta",
    from:"2026-10", to:"2027-03", availabilityModel:"Sezonowo",
    volumeMin:"50", volumeMax:"150", volumeUnit:"T/mies.",
    moq:"1 Paleta", leadTime:"48h",
    promoVolume:"Tak", promoVolumePct:"20",
    deliveryDays:["Pon","Wt","Śr","Czw","Pt"],
    packaging:["Karton","Siatka"], customPackaging:"", packagingDesc:"Karton 15 kg lub siatka 1–3 kg retail",
    palletType:"EUR", palletHeight:"180 cm", cartonsPerLayer:"8", layersPerPallet:"6", unitsPerPallet:"48",
    srp:"Do uzgodnienia",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Walencja, Hiszpania",
    deliveryRegions:"PL, DE, CZ, SK — cała CEE",
    coldChain:"Po stronie dostawcy", tempTransport:"5–8°C",
    traceability:"Tak", certs:["GlobalGAP","BRC"], customCert:"",
    certNumber:"GGN-UNICA-2026-001", certValid:"2026-12-31", currentTests:"Tak",
    currency:"EUR", priceOffer:"0.55", priceUnit:"kg", incoterm:"DDP",
    priceFrom:"2026-10-01", priceTo:"2027-03-31",
    promoPrice:"Tak", contractProgram:"Tak", samplesAvail:"Tak — wyślemy",
    benefit1:"Program stały X–III — zero przerw w dostawach przez cały sezon cytrusowy",
    benefit2:"DDP Walencja → CD: jedna faktura, brak dodatkowej logistyki po stronie sieci",
    benefit3:"Możliwość mix-palet (pomarańcze + mandarynki) bez MOQ na odmianę",
    shopBenefit:"Cytrusy w sezonie jesienno-zimowym = top 5 sprzedaży owoców. Siatka 1 kg = impuls przy kasie.",
    riskMitigation:"Własne sady 800 ha, brak zależności od skupu. Sortownia optyczna + certyfikat klasy I.",
    riskProof:"Dostawca sieci Carrefour ES/PL, Lidl DE. GlobalGAP + BRC aktywne.",
    riskNow:"Sezon 2026/27 startuje październik — okno kontraktowe zamknięte sierpień.",
    cta:["long_term","samples"],
    volume:"150", volumeUnit2:"T/mies.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"premium"
  },
  {
    id:2, supplierId:"sup-s1", product:"Winogrona stołowe", variety:"Thompson Seedless / Red Globe", category:"owoce", subcategory:"winogrona",
    origin:"ES", region:"Murcja",
    offerType:"Propozycja sezonowa", positioning:"Premium",
    title:"Winogrona stołowe Murcja — bezpestkowe, kaliber AA, sezon VII–X",
    description:"Nasz produkt wyróżnia:\n**Jakość i odmiana-** Thompson Seedless (zielone) i Red Globe (czerwone) klasy Extra.\n**Dostępność-** Lipiec–październik, 80 T/tydzień w szczycie.\n**Opakowanie-** Punnet 500g i 1kg retail-ready.",
    size:"Jagoda 18–22 mm (AA)", qualityClass:"Klasa Extra",
    qualitySpec:"Winogrona z nawodnionej doliny Murcji. Cukry min. 16°Brix. Brak pestek (Thompson). Trwałość 14 dni.",
    brand:"Unica Group", saleMode:"Marka producenta",
    from:"2026-07", to:"2026-10", availabilityModel:"Sezonowo",
    volumeMin:"30", volumeMax:"80", volumeUnit:"T/tyg.",
    moq:"1 Paleta", leadTime:"48h",
    promoVolume:"Tak", promoVolumePct:"15", deliveryDays:["Pon","Śr","Pt"],
    packaging:["Punnet","Karton"], customPackaging:"", packagingDesc:"Punnet 500g / 1kg lub karton 8 kg luzem",
    palletType:"EUR", palletHeight:"175 cm", srp:"Tak",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Murcja, Hiszpania",
    deliveryRegions:"PL, DE, CZ", coldChain:"Po stronie dostawcy", tempTransport:"0–2°C",
    traceability:"Tak", certs:["GlobalGAP","BRC"], customCert:"",
    certNumber:"GGN-UNICA-2026-002", certValid:"2026-10-31", currentTests:"Tak",
    currency:"EUR", priceOffer:"1.80", priceUnit:"kg", incoterm:"DDP",
    priceFrom:"2026-07-01", priceTo:"2026-10-31",
    promoPrice:"Tak", contractProgram:"Nie", samplesAvail:"Tak — wyślemy",
    benefit1:"Klasa Extra kaliber AA — premium na półce, wyższa marża dla sieci",
    benefit2:"Bezpestkowe Thompson Seedless = zero reklamacji konsumenckich",
    benefit3:"Punnet retail-ready z EAN — bezpośrednio na półkę bez przepakowania",
    shopBenefit:"Winogrona premium segment rośnie +15% r/r. Punnet 500g = impuls zakupowy.",
    riskMitigation:"Własne 120 ha + partnerzy w Murcji. Pełna identyfikowalność.",
    riskNow:"Szczyt sezonu sierpień–wrzesień — kontrakt do 30 czerwca.",
    cta:["samples","rfq"],
    volume:"80", volumeUnit2:"T/tyg.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"standard"
  },
  {
    id:3, supplierId:"sup-s1", product:"Owoce pestkowe", variety:"Peach / Nectarine / Plum mix", category:"owoce", subcategory:"owoce pestkowe",
    origin:"ES", region:"Lleida / Aragonia",
    offerType:"Propozycja sezonowa", positioning:"Codzienna półka",
    title:"Owoce pestkowe ES — brzoskwinie, nektaryny, śliwki, sezon VI–IX",
    description:"Nasz produkt wyróżnia:\n**Jakość i odmiana-** Brzoskwinie Royal Glory, nektaryny Stark Red Gold, śliwki President — klasa I/Extra.\n**Wolumen-** 100 T/tydzień łącznie w szczycie sezonu.\n**Logistyka-** Transport chłodniczy 36h do PL.",
    qualitySpec:"Kaliber AA-AA, Brix min. 9°. Zbiór mechaniczny + sortownia optyczna Lleida.",
    brand:"Unica Group", saleMode:"Marka producenta",
    from:"2026-06", to:"2026-09", availabilityModel:"Sezonowo",
    volumeMin:"50", volumeMax:"100", volumeUnit:"T/tyg.",
    moq:"1 Paleta", leadTime:"36h", promoVolume:"Tak", promoVolumePct:"25",
    deliveryDays:["Pon","Wt","Śr","Czw","Pt"],
    packaging:["Karton","IFCO"], packagingDesc:"Karton 5–8 kg lub IFCO 6417",
    palletType:"EUR", srp:"Nie",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Lleida, Katalonia",
    deliveryRegions:"PL, DE, CZ, NL", coldChain:"Po stronie dostawcy", tempTransport:"0–4°C",
    traceability:"Tak", certs:["GlobalGAP","BRC"], customCert:"",
    certNumber:"GGN-UNICA-2026-003", certValid:"2026-09-30", currentTests:"Tak",
    currency:"EUR", priceOffer:"0.90", priceUnit:"kg", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Nie", samplesAvail:"Tak — wyślemy",
    benefit1:"Trzy gatunki w jednym programie — stały asortyment przez cały sezon letni",
    benefit2:"Transport 36h Lleida→PL = max świeżość przy dostawie",
    shopBenefit:"Owoce pestkowe to top lato — wyjście z cytrusów w czerwcu bez przerwy w ofercie.",
    riskMitigation:"Własne + partnerskie 400 ha Lleida/Aragonia. Stały partner dla sieci DE/NL.",
    riskNow:"Kontrakt letni przed 15 maja — po tym terminie wolumeny zarezerwowane.",
    cta:["long_term","meet_fm"],
    volume:"100", volumeUnit2:"T/tyg.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"standard"
  },

  /* ── PIK GLOBAL — warzywa ──────────────────────────────────── */
  {
    id:4, supplierId:"sup-s5", product:"Marchew", variety:"Napoli F1 / Nutri Red", category:"warzywa", subcategory:"marchew",
    origin:"PL", region:"Kujawy",
    offerType:"Program stały", positioning:"Codzienna półka",
    title:"Marchew myta PL — Flowpack 500g–1kg, całoroczna, chłodnia CA",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Marchew myta, kalibrowana, odmiana Napoli F1 — słodka, twarda. Flowpack gotowy do ekspozycji.\n**Dostępność-** Całoroczna z chłodni CA 1200T.\n**Cena-** Stała cena roczna, brak wahań sezonowych.",
    qualitySpec:"Marchew myta + szczotkowana. Kaliber 18–30 mm. Trwałość 14 dni. Odpady <1%.",
    brand:"PIK GLOBAL", saleMode:"Marka producenta",
    from:"2026-01", to:"2026-12", availabilityModel:"Całorocznie",
    volumeMin:"20", volumeMax:"35", volumeUnit:"T/tyg.",
    moq:"1 Paleta", leadTime:"48h", promoVolume:"Tak", promoVolumePct:"20",
    deliveryDays:["Pon","Wt","Śr","Czw","Pt"],
    packaging:["Flowpack","Karton"], packagingDesc:"Flowpack 500g / 1kg z EAN lub karton 10 kg",
    palletType:"EUR", srp:"Tak",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Inowrocław, Kujawy",
    deliveryRegions:"PL, DE, CZ", coldChain:"Po stronie dostawcy", tempTransport:"2–5°C",
    traceability:"Tak", certs:["GlobalGAP"], customCert:"",
    certNumber:"GGN-PIK-2026-001", certValid:"2026-12-31", currentTests:"Tak",
    currency:"PLN", priceOffer:"3.20", priceUnit:"kg", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Tak", samplesAvail:"Tak — wyślemy",
    benefit1:"Całoroczna dostępność z chłodni CA — zero przerw w programie",
    benefit2:"Stała cena przez 12 miesięcy — pewna kalkulacja marży",
    benefit3:"Flowpack z EAN gotowy na półkę — zero kosztów przepakowania",
    shopBenefit:"Marchew = top 3 warzywniak. Format 500g = impuls zakupowy convenience.",
    riskMitigation:"Chłodnia CA 1200T, własne 80 ha. Identyfikowalność pola→palety.",
    riskNow:"Kontrakt roczny 2026 — wdrożenie private label 6 tygodni od podpisu.",
    cta:["long_term","call"],
    volume:"35", volumeUnit2:"T/tyg.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"standard"
  },
  {
    id:5, supplierId:"sup-s5", product:"Cebula", variety:"Sturon / Hyduro", category:"warzywa", subcategory:"cebula",
    origin:"PL", region:"Wielkopolska",
    offerType:"Program stały", positioning:"Codzienna półka",
    title:"Cebula żółta PL — siatka 1–2 kg, całoroczna, własna chłodnia",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Cebula odmiany Sturon — twarda skórka, długa trwałość. Siatka 1 kg i 2 kg retail-ready.\n**Dostępność-** IX–VI z własnej chłodni 2000T.\n**Cena-** Stała przez 9 miesięcy.",
    qualitySpec:"Cebula sucha, kaliber 50–70 mm, klasa I. Skórka złota, twarda. Trwałość 30 dni. Odpady <2%.",
    brand:"PIK GLOBAL", saleMode:"Marka producenta",
    from:"2026-09", to:"2027-06", availabilityModel:"Sezonowo",
    volumeMin:"30", volumeMax:"60", volumeUnit:"T/tyg.",
    moq:"1 Paleta", leadTime:"48h", promoVolume:"Tak", promoVolumePct:"30",
    deliveryDays:["Pon","Wt","Śr","Czw","Pt"],
    packaging:["Siatka","Karton"], packagingDesc:"Siatka 1 kg / 2 kg / 5 kg lub worek 20 kg",
    palletType:"EUR", srp:"Nie",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Szamotuły, Wielkopolska",
    deliveryRegions:"PL, DE, CZ, NL", coldChain:"Nie dotyczy", tempTransport:"5–10°C",
    traceability:"Tak", certs:["GlobalGAP","GRASP"], customCert:"",
    certNumber:"GGN-PIK-2026-002", certValid:"2026-11-30", currentTests:"Tak",
    currency:"PLN", priceOffer:"2.40", priceUnit:"kg", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Tak", samplesAvail:"Tak — wyślemy",
    benefit1:"Niska cena + stały wolumen 30–60 T/tyg. przez 9 miesięcy sezonu",
    benefit2:"Siatka retail-ready 1 kg z EAN — bezpośrednio na półkę",
    benefit3:"Możliwość private label na siatce bez minimalnego wolumenu na format",
    shopBenefit:"Cebula = must-have na każdej półce warzywniak. Format 1 kg = zakup planowany.",
    riskMitigation:"Chłodnia 2000T. Własne 150 ha + 4 gospodarstwa partnerskie Szamotuły.",
    riskNow:"Kontrakt sezonu 2026/27 — wolumeny dostępne od września. Okno do 30 lipca.",
    cta:["long_term","rfq"],
    volume:"60", volumeUnit2:"T/tyg.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"standard"
  },
  {
    id:6, supplierId:"sup-s5", product:"Brokuł", variety:"Ironman F1 / Monaco F1", category:"warzywa", subcategory:"brokuły",
    origin:"PL", region:"Zachodniopomorskie",
    offerType:"Propozycja sezonowa", positioning:"Codzienna półka",
    title:"Brokuły gruntowe PL — zbiór rano, chłodzenie 2h, cena –15% vs import",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Brokuły Ironman F1, zwarty ciemnozielony kwiatostan. Zbiór 4:00–8:00, schłodzone do 2h.\n**Cena-** O 15% taniej niż import ES przy tej samej specyfikacji.",
    qualitySpec:"Głowica 12–18 cm. Schłodzone do 1°C w 2h od zbioru. Trwałość 10 dni. Odpady <2%.",
    brand:"PIK GLOBAL", saleMode:"Marka producenta",
    from:"2026-06", to:"2026-10", availabilityModel:"Sezonowo",
    volumeMin:"20", volumeMax:"30", volumeUnit:"T/tyg.",
    moq:"1 Paleta", leadTime:"24h", promoVolume:"Tak", promoVolumePct:"15",
    deliveryDays:["Pon","Wt","Śr","Czw","Pt"],
    packaging:["IFCO","Karton"], packagingDesc:"IFCO 6417 lub karton 5 kg",
    palletType:"EUR", srp:"Nie",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Recz, woj. zachodniopomorskie",
    deliveryRegions:"PL, DE, CZ", coldChain:"Po stronie dostawcy", tempTransport:"0–2°C",
    traceability:"Tak", certs:["GlobalGAP"], customCert:"",
    certNumber:"GGN-PIK-2026-003", certValid:"2026-10-31", currentTests:"Tak",
    currency:"PLN", priceOffer:"3.80", priceUnit:"kg", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Nie", samplesAvail:"Tak — wyślemy",
    benefit1:"Cena –15% vs import ES przy identycznej specyfikacji Ironman F1",
    benefit2:"24h od zbioru do dostawy — max świeżość, mniej odpadów na półce",
    benefit3:"Sezonowość PL = narracja lokalna, rosnące znaczenie w komunikacji sieci",
    shopBenefit:"Brokuł sezonowy PL dłuższa trwałość niż import. Etykieta daty zbioru buduje zaufanie.",
    riskMitigation:"Własne 40 ha. Pełna identyfikowalność pole→paleta.",
    riskNow:"Sezon VI–X. Kontrakt do 15 maja.",
    cta:["samples","call"],
    volume:"30", volumeUnit2:"T/tyg.", minOrder:"1 Paleta",
    status:"active", photos:[], tier:"standard"
  },

  /* ── FRESH INSIDE — kwiaty ─────────────────────────────────── */
  {
    id:7, supplierId:"sup-s14", product:"Róże cięte", variety:"Red Naomi / Avalanche mix", category:"kwiaty", subcategory:"róże",
    origin:"NL", region:"Aalsmeer, FloraHolland",
    offerType:"Program stały", positioning:"Premium",
    title:"Róże cięte NL — Red Naomi + Avalanche, vase life 14 dni, import bezpośredni",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Red Naomi (czerwona) i Avalanche (biała) klasa A z giełdy FloraHolland.\n**Trwałość-** Vase life 12–14 dni przy stosowaniu Chrysal.\n**Logistyka-** Transport chłodniczy NL→PL 24h.",
    stemLength:"50–70 cm", openingPhase:"Pąk zamknięty (cut stage 1–2)", bouquetCount:"10", vaseLife:"12–14 dni",
    flowerColor:"Czerwona (Red Naomi) + biała (Avalanche) — 2 kolory lub mix",
    qualitySpec:"Klasa A FloraHolland. Łodygi proste min. 50 cm. Pąk zamknięty. Certyfikat MPS-ABC.",
    brand:"Fresh Inside", saleMode:"Marka producenta",
    from:"2026-01", to:"2026-12", availabilityModel:"Całorocznie",
    volumeMin:"500", volumeMax:"2000", volumeUnit:"szt/tyg.",
    moq:"100 szt. (10 bukietów)", leadTime:"48h",
    promoVolume:"Tak", promoVolumePct:"50",
    deliveryDays:["Pon","Wt"],
    packaging:["Bukiet","Karton"], packagingDesc:"Bukiet 10 szt. folia + etykieta, karton 100 szt.",
    palletType:"EUR",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Aalsmeer, Holandia",
    deliveryRegions:"PL, DE, CZ", coldChain:"Po stronie dostawcy", tempTransport:"2–5°C",
    traceability:"Tak", certs:["GlobalGAP"], customCert:"MPS-ABC",
    certNumber:"MPS-FI-2026-001", certValid:"2026-12-31", currentTests:"Nie",
    currency:"PLN", priceOffer:"3.20", priceUnit:"szt.", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Tak", samplesAvail:"Po uzgodnieniu",
    benefit1:"Vase life 14 dni — mniej reklamacji konsumenckich i zwrotów ze sklepu",
    benefit2:"Import bezpośredni FloraHolland — cena –15% vs pośrednik",
    benefit3:"Walentynki / Dzień Kobiet / Wielkanoc: +50% wolumenu na promo",
    shopBenefit:"Róże to #1 kwiaty cięte przez cały rok. Bukiet 10 szt. = format impulsowy.",
    riskMitigation:"Zakup bezpośredni na giełdzie FloraHolland z certyfikatem klasy A.",
    riskNow:"Okno walentynkowe (luty) — kontrakt do 20 stycznia.",
    cta:["long_term","meet_fm"],
    volume:"2000", volumeUnit2:"szt/tyg.", minOrder:"100 szt.",
    status:"active", photos:[], tier:"premium"
  },
  {
    id:8, supplierId:"sup-s14", product:"Tulipany cięte", variety:"Darwin Hybrid mix", category:"kwiaty", subcategory:"tulipany",
    origin:"NL", region:"Aalsmeer, FloraHolland",
    offerType:"Propozycja sezonowa", positioning:"Sezonowe",
    title:"Tulipany cięte NL — 10 kolorów, import FloraHolland, vase life 10 dni",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Darwin Hybrid i Triumph mix — 10 kolorów klasa A.\n**Vase life-** 10–12 dni. Łodygi 40–50 cm.\n**Dostępność-** Luty–maj, 5000–15000 szt./tydzień.",
    stemLength:"40–50 cm", openingPhase:"Pąk zamknięty", bouquetCount:"10", vaseLife:"10–12 dni",
    flowerColor:"Mix 10 kolorów: czerwony, żółty, różowy, biały, fioletowy…",
    qualitySpec:"Klasa A FloraHolland. MPS-ABC. Łodygi min. 40 cm, pąk zamknięty.",
    brand:"Fresh Inside", saleMode:"Marka producenta",
    from:"2026-02", to:"2026-05", availabilityModel:"Sezonowo",
    volumeMin:"2000", volumeMax:"15000", volumeUnit:"szt/tyg.",
    moq:"500 szt.", leadTime:"48h", promoVolume:"Tak", promoVolumePct:"100",
    deliveryDays:["Pon","Wt"],
    packaging:["Bukiet","Karton"], packagingDesc:"Bukiet 10 szt. lub karton 100 szt.",
    palletType:"EUR",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Aalsmeer, Holandia",
    deliveryRegions:"PL, DE, CZ", coldChain:"Po stronie dostawcy", tempTransport:"2–5°C",
    traceability:"Tak", certs:["GlobalGAP"], customCert:"MPS-ABC",
    certNumber:"MPS-FI-2026-002", certValid:"2026-05-31", currentTests:"Nie",
    currency:"PLN", priceOffer:"2.60", priceUnit:"szt.", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Nie", samplesAvail:"Po uzgodnieniu",
    benefit1:"Tulipan #1 kwiat cięty II–IV w Polsce — pewna sprzedaż w sezonie",
    benefit2:"Import FloraHolland –15% vs pośrednik, cena atrakcyjna dla sieci",
    benefit3:"Zamówienia specjalne (kolor, odmiana) przy 7-dniowym wyprzedzeniu",
    shopBenefit:"Tulipany to must-have marzec (Dzień Kobiet) i Wielkanoc. Bukiet 10 szt. impuls.",
    riskMitigation:"Zakup bezpośredni FloraHolland gwarancja klasy A na każdej dostawie.",
    riskNow:"Szczyt II–IV. Kontrakt do 31 stycznia 2026.",
    cta:["meet_fm","rfq"],
    volume:"15000", volumeUnit2:"szt/tyg.", minOrder:"500 szt.",
    status:"active", photos:[], tier:"standard"
  },
  {
    id:9, supplierId:"sup-s14", product:"Gerbery", variety:"Gerbera mix", category:"kwiaty", subcategory:"gerbery",
    origin:"NL", region:"Westland, Holandia",
    offerType:"Program stały", positioning:"Codzienna półka",
    title:"Gerbery cięte NL — mix 8 kolorów, całoroczne, vase life 10 dni",
    description:"Nasz produkt wyróżnia:\n**Jakość-** Gerbery mini i standard — 8 kolorów, klasa A.\n**Trwałość-** 10 dni vase life.\n**Dostępność-** Całorocznie.",
    stemLength:"40–55 cm", openingPhase:"Otwarty 50%", bouquetCount:"5", vaseLife:"8–10 dni",
    flowerColor:"8 kolorów: czerwony, pomarańcz, żółty, różowy, biały, fiolet…",
    qualitySpec:"Klasa A. Łodygi proste min. 40 cm. Vase life 8–10 dni.",
    brand:"Fresh Inside", saleMode:"Marka producenta",
    from:"2026-01", to:"2026-12", availabilityModel:"Całorocznie",
    volumeMin:"500", volumeMax:"3000", volumeUnit:"szt/tyg.",
    moq:"50 bukietów", leadTime:"48h", promoVolume:"Tak", promoVolumePct:"30",
    deliveryDays:["Pon","Wt"],
    packaging:["Bukiet"], packagingDesc:"Bukiet 5 szt. z etykietą",
    palletType:"EUR",
    deliveryModel:"Centrum dystrybucyjne (CD)", loadingPoint:"Westland, Holandia",
    deliveryRegions:"PL, DE", coldChain:"Po stronie dostawcy", tempTransport:"5–8°C",
    traceability:"Tak", certs:["GlobalGAP"], customCert:"MPS-ABC",
    certNumber:"MPS-FI-2026-003", certValid:"2026-12-31", currentTests:"Nie",
    currency:"PLN", priceOffer:"2.10", priceUnit:"szt.", incoterm:"DDP",
    promoPrice:"Tak", contractProgram:"Tak", samplesAvail:"Po uzgodnieniu",
    benefit1:"Całoroczna dostępność — stały asortyment bez przerw sezonowych",
    benefit2:"8 kolorów = elastyczność ekspozycji pod kampanie sezonowe",
    shopBenefit:"Gerbery kolorowe = impuls wizualny przy wejściu do sklepu.",
    riskMitigation:"Import bezpośredni Westland. Klasa A na każdej dostawie.",
    cta:["long_term","call"],
    volume:"3000", volumeUnit2:"szt/tyg.", minOrder:"50 bukietów",
    status:"active", photos:[], tier:"standard"
  },
]
const SENDS_INIT = [
  /* ── UNICA GROUP (s1) — oferty wysłane ─────────────────── */
  { id:1,  supplierId:"sup-s1", offerId:1, retailerId:100, month:"2026-04", pos:1, status:"read",               sentAt:"2026-04-01", readAt:"2026-04-03", price:40, sendDate:"2026-04-01", daysLeft:0,  confirmHistory:[] },
  { id:2,  supplierId:"sup-s1", offerId:2, retailerId:103, month:"2026-04", pos:2, status:"read_manual",        sentAt:"2026-04-01", readAt:"2026-04-07", readType:"manual_phone", manualNote:"Kupiec potwierdził tel.", price:40, sendDate:"2026-04-01", daysLeft:0, confirmHistory:[{action:"confirm",type:"manual_phone",note:"Kupiec potwierdził tel.",at:"2026-04-07 14:30"}] },
  { id:3,  supplierId:"sup-s1", offerId:3, retailerId:106, month:"2026-04", pos:3, status:"sent",               sentAt:"2026-04-01", price:40, sendDate:"2026-04-01", daysLeft:5, confirmHistory:[] },
  { id:4,  supplierId:"sup-s1", offerId:1, retailerId:104, month:"2026-05", pos:1, status:"pending_moderation", price:40, sendDate:"2026-05-06", daysLeft:14, confirmHistory:[] },
  { id:5,  supplierId:"sup-s1", offerId:2, retailerId:110, month:"2026-05", pos:2, status:"approved",           price:40, sendDate:"2026-05-06", daysLeft:14, confirmHistory:[] },
  /* ── PIK GLOBAL (s5) — oferty wysłane ──────────────────── */
  { id:6,  supplierId:"sup-s5", offerId:4, retailerId:100, month:"2026-04", pos:1, status:"read",               sentAt:"2026-04-01", readAt:"2026-04-06", price:40, sendDate:"2026-04-01", daysLeft:0,  confirmHistory:[] },
  { id:7,  supplierId:"sup-s5", offerId:5, retailerId:101, month:"2026-04", pos:2, status:"sent",               sentAt:"2026-04-01", price:40, sendDate:"2026-04-01", daysLeft:4, confirmHistory:[] },
  { id:8,  supplierId:"sup-s5", offerId:6, retailerId:103, month:"2026-04", pos:3, status:"read",               sentAt:"2026-04-01", readAt:"2026-04-09", price:40, sendDate:"2026-04-01", daysLeft:0,  confirmHistory:[] },
  { id:9,  supplierId:"sup-s5", offerId:4, retailerId:106, month:"2026-05", pos:1, status:"pending_moderation", price:40, sendDate:"2026-05-06", daysLeft:14, confirmHistory:[] },
  { id:10, supplierId:"sup-s5", offerId:5, retailerId:102, month:"2026-03", pos:2, status:"unread_expired",     sentAt:"2026-03-05", price:40, sendDate:"2026-03-05", daysLeft:0,  confirmHistory:[] },
  /* ── FRESH INSIDE (s14) — oferty wysłane ───────────────── */
  { id:11, supplierId:"sup-s14", offerId:7, retailerId:103, month:"2026-04", pos:1, status:"read",               sentAt:"2026-04-01", readAt:"2026-04-04", price:40, sendDate:"2026-04-01", daysLeft:0,  confirmHistory:[] },
  { id:12, supplierId:"sup-s14", offerId:8, retailerId:104, month:"2026-04", pos:2, status:"sent",               sentAt:"2026-04-01", price:40, sendDate:"2026-04-01", daysLeft:7, confirmHistory:[] },
  { id:13, supplierId:"sup-s14", offerId:9, retailerId:110, month:"2026-04", pos:3, status:"pending_moderation", price:40, sendDate:"2026-04-01", daysLeft:14, confirmHistory:[] },
  { id:14, supplierId:"sup-s14", offerId:7, retailerId:106, month:"2026-05", pos:1, status:"approved",           price:40, sendDate:"2026-05-06", daysLeft:14, confirmHistory:[] },
]
const LIMITS_INIT = [
  { id:"sup-s1",  name:"UNICA GROUP",  country:"ES", pkg:"prem_10", max:10, used:5,  pkgExpiry:"2026-12-31", email:"sales@unicagroup.com" },
  { id:"sup-s5",  name:"PIK GLOBAL",   country:"PL", pkg:"std_10",  max:10, used:5,  pkgExpiry:"2026-12-31", email:"sales@pikglobal.pl" },
  { id:"sup-s14", name:"FRESH INSIDE", country:"PL", pkg:"prem_10", max:10, used:4,  pkgExpiry:"2026-12-31", email:"sales@freshinside.pl" },
];

const WALLET_INIT = { balance: 0, transactions: [] };

function getOffer(id, offers)  { return (offers||[]).find(x=>x.id===id)||OFFERS_INIT.find(x=>x.id===id); }
// Offer title helpers
function getPublicOfferTitle(o)   { return o?.title || o?.product || "—"; }
function getInternalOfferTitle(o) { return o?.internalTitle || null; }
function getSupplierOfferLabel(o) {
  const pub = getPublicOfferTitle(o);
  const priv = getInternalOfferTitle(o);
  return priv && priv !== pub ? `${priv} | ${pub}` : pub;
}
function getRetailerCats(r) {
  if (r && r.cats && r.cats.length > 0) return r.cats;
  if (r && r.buyers && r.buyers.length > 0) {
    return [...new Set((r.buyers).flatMap(b => b.cats || []))];
  }
  return [];
}
function isUuidLike(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function nowStr()               { return new Date().toISOString().slice(0,16).replace("T"," "); }

// Nowy model cenowy: pakiety wysyłek (1 wysyłka = 1 oferta do 1 sieci/dystrybutora)
const PRICING_PLANS=[
  { id:"std_1",  tier:"STANDARD", qty:1,  price:50,   perSend:50, discount:0,  color:"#3b82f6", bg:"#eff6ff" },
  { id:"std_5",  tier:"STANDARD", qty:5,  price:225,  perSend:45, discount:10, color:"#0d9488", bg:"#f0fdf4" },
  { id:"std_10", tier:"STANDARD", qty:10, price:400,  perSend:40, discount:20, color:"#7c3aed", bg:"#faf5ff", popular:true },
  { id:"std_20", tier:"STANDARD", qty:20, price:700,  perSend:35, discount:30, color:"#1e3a5f", bg:"#f1f5f9" },
  { id:"std_50", tier:"STANDARD", qty:50, price:1500, perSend:30, discount:40, color:"#0f766e", bg:"#f0fdfa" },
  { id:"prem_1",  tier:"PREMIUM", qty:1,  price:80,   perSend:80, discount:0,  color:"#d97706", bg:"#fffbeb" },
  { id:"prem_5",  tier:"PREMIUM", qty:5,  price:350,  perSend:70, discount:13, color:"#d97706", bg:"#fffbeb" },
  { id:"prem_10", tier:"PREMIUM", qty:10, price:600,  perSend:60, discount:25, color:"#b45309", bg:"#fef3c7", popular:true },
  { id:"prem_20", tier:"PREMIUM", qty:20, price:1000, perSend:50, discount:38, color:"#92400e", bg:"#fef3c7" },
  { id:"prem_50", tier:"PREMIUM", qty:50, price:2250, perSend:45, discount:44, color:"#78350f", bg:"#fef3c7" },
];
const PKG_OPTS=[
  { id:"std_1",   label:"Standard – 1 wysyłka",   max:1,  price:50,   perSend:50, tier:"STANDARD" },
  { id:"std_5",   label:"Standard – 5 wysyłek",   max:5,  price:225,  perSend:45, tier:"STANDARD" },
  { id:"std_10",  label:"Standard – 10 wysyłek",  max:10, price:400,  perSend:40, tier:"STANDARD" },
  { id:"std_20",  label:"Standard – 20 wysyłek",  max:20, price:700,  perSend:35, tier:"STANDARD" },
  { id:"std_50",  label:"Standard – 50 wysyłek",  max:50, price:1500, perSend:30, tier:"STANDARD" },
  { id:"prem_1",  label:"Premium – 1 wysyłka",    max:1,  price:80,   perSend:80, tier:"PREMIUM" },
  { id:"prem_5",  label:"Premium – 5 wysyłek",    max:5,  price:350,  perSend:70, tier:"PREMIUM" },
  { id:"prem_10", label:"Premium – 10 wysyłek",   max:10, price:600,  perSend:60, tier:"PREMIUM" },
  { id:"prem_20", label:"Premium – 20 wysyłek",   max:20, price:1000, perSend:50, tier:"PREMIUM" },
  { id:"prem_50", label:"Premium – 50 wysyłek",   max:50, price:2250, perSend:45, tier:"PREMIUM" },
];
// Renders description text: **Bold-** becomes <strong>Bold-</strong>
function renderDesc(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i} style={{ fontWeight:700 }}>{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}
function getPlanById(id){ return PRICING_PLANS.find(p=>p.id===id); }
function getPlanLabel(id){ const p=getPlanById(id); if(!p) return id; return `${p.tier==="PREMIUM"?"Premium":"Standard"} ${p.qty} ${p.qty===1?"wysyłka":p.qty<5?"wysyłki":"wysyłek"} (${p.perSend} EUR/szt.)`; }

/* ─────────────── UI PRIMITIVES ────────────────────────────────────────────── */
function Badge({ children, color="#64748b", bg }) {
  return <span style={{ padding:"2px 10px",borderRadius:4,fontSize:11,fontWeight:600,color,background:bg||color+"18",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3 }}>{children}</span>;
}
function Btn({ children, primary, outline, sm, dark, danger, disabled, onClick, full, style:sx }) {
  const bg  = disabled?"#e2e8f0":danger?"#dc2626":dark?"#1e3a5f":primary?"#0d9488":outline?"white":"#f1f5f9";
  const clr = disabled?"#94a3b8":(primary||dark||danger)?"white":"#475569";
  return <button disabled={disabled} onClick={onClick} style={{ display:"inline-flex",alignItems:"center",justifyContent:full?"center":undefined,gap:6,padding:sm?"5px 10px":"9px 18px",borderRadius:8,fontSize:sm?12:13,fontWeight:600,border:outline?"1px solid #dde":"none",background:bg,color:clr,cursor:disabled?"not-allowed":"pointer",width:full?"100%":undefined,fontFamily:"inherit",...sx }}>{children}</button>;
}
function Card({ title, icon:Ic, children, actions, noPad, style:sx }) {
  return <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden",marginBottom:16,...sx }}>{title&&<div style={{ padding:"12px 18px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:8 }}>{Ic&&<Ic size={16} color="#0d9488"/>}<strong style={{ fontSize:14 }}>{title}</strong>{actions&&<div style={{ marginLeft:"auto" }}>{actions}</div>}</div>}<div style={noPad?{}:{ padding:"16px 18px" }}>{children}</div></div>;
}
function Stat({ label, value, color="#1e293b", hero, sub, children }) {
  const base = hero?{ background:"linear-gradient(135deg,#1e3a5f,#2d5a8e)",color:"white" }:{ background:"white",border:"1px solid #e2e8f0" };
  return <div style={{ flex:1,minWidth:hero?200:130,padding:"16px 18px",borderRadius:12,...base }}><div style={{ fontSize:12,...(hero?{opacity:0.7}:{color:"#64748b"}) }}>{label}</div><div style={{ fontSize:hero?20:26,fontWeight:700,color:hero?"white":color,marginTop:2 }}>{value}</div>{sub&&<div style={{ fontSize:11,marginTop:3,...(hero?{opacity:0.65}:{color:"#94a3b8"}) }}>{sub}</div>}{children}</div>;
}
function TagToggle({ items, active=[], onChange }) {
  return <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>{items.map(([val,label])=>{ const on=active.includes(val); return <span key={val} onClick={()=>onChange(on?active.filter(x=>x!==val):[...active,val])} style={{ padding:"6px 12px",borderRadius:7,fontSize:12,fontWeight:on?600:500,background:on?"rgba(13,148,136,0.08)":"#f1f5f9",color:on?"#0d9488":"#64748b",border:`2px solid ${on?"#0d9488":"transparent"}`,cursor:"pointer",userSelect:"none" }}>{label}</span>; })}</div>;
}
function Alrt({ type="info", children }) {
  const cfgs={info:["#eff6ff","#bfdbfe","#1e40af",Info],success:["#d1fae5","#a7f3d0","#047857",CheckCircle],warning:["#fffbeb","#fde68a","#92400e",AlertTriangle],error:["#fee2e2","#fca5a5","#dc2626",X]};
  const c=cfgs[type]||cfgs.info; const Ic=c[3];
  return <div style={{ padding:"12px 18px",borderRadius:10,marginBottom:16,display:"flex",alignItems:"flex-start",gap:10,fontSize:13,background:c[0],border:`1px solid ${c[1]}`,color:c[2] }}><Ic size={16} style={{ flexShrink:0,marginTop:1 }}/><div>{children}</div></div>;
}
function Inp({ label, required, hint, ta, children, style:sx, ...p }) {
  const baseInput={ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" };
  return <div style={{ marginBottom:14 }}>{label&&<label style={{ display:"block",fontSize:12,fontWeight:500,color:"#334155",marginBottom:5 }}>{label}{required&&" *"}</label>}{ta?<textarea {...p} style={{ ...baseInput,minHeight:72,resize:"vertical",...sx }}/>:children?<select {...p} style={{ ...baseInput,...sx }}>{children}</select>:<input {...p} style={{ ...baseInput,...sx }}/>}{hint&&<div style={{ fontSize:11,color:"#94a3b8",marginTop:3 }}>{hint}</div>}</div>;
}
function Row({ children }) { return <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>{children}</div>; }
function RetailerLogo({ retailer, size=40 }) {
  if (!retailer) return null;
  // Jeśli retailer ma logo_url - pokazujemy obrazek, inaczej fallback do inicjałów
  if (retailer.logo_url) {
    return <div style={{ width:size,height:size,borderRadius:Math.round(size*0.22),background:"white",border:`2px solid ${retailer.color}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden" }}>
      <img src={retailer.logo_url} alt={retailer.name||""} style={{ width:"100%",height:"100%",objectFit:"contain" }}/>
    </div>;
  }
  return <div style={{ width:size,height:size,borderRadius:Math.round(size*0.22),background:retailer.bg||"#f1f5f9",border:`2px solid ${retailer.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:Math.round(size*0.3),color:retailer.color,flexShrink:0,letterSpacing:-1 }}>{retailer.initials}</div>;
}
function Modal({ title, onClose, children, wide }) {
  return <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{ background:"white",borderRadius:16,maxWidth:wide?820:500,width:"100%",maxHeight:"92vh",overflow:"auto" }}><div style={{ padding:"16px 20px",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"white",zIndex:1 }}><strong style={{ fontSize:15 }}>{title}</strong><button onClick={onClose} style={{ background:"none",border:"none",cursor:"pointer",padding:4 }}><X size={18}/></button></div><div style={{ padding:20 }}>{children}</div></div></div>;
}
function TrackingBar({ daysLeft, status }) {
  const isRead=["read","read_manual"].includes(status);
  const pct=Math.max(0,Math.min(100,((14-(daysLeft||0))/14)*100));
  const color=isRead?"#059669":(daysLeft||0)<=3?"#dc2626":(daysLeft||0)<=7?"#f59e0b":"#3b82f6";
  return <div style={{ marginTop:5 }}><div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8",marginBottom:2 }}><span>Tracking 14 dni</span><span style={{ color }}>{isRead?"✅ Potwierdzona":(daysLeft||0)>0?`${daysLeft} dni`:"⚠ Wygasła"}</span></div><div style={{ background:"#e2e8f0",borderRadius:3,height:4,overflow:"hidden" }}><div style={{ height:"100%",borderRadius:3,width:`${isRead?100:pct}%`,background:color }}/></div></div>;
}
function RetailerLogo2({ retailer, size=40 }) { return <RetailerLogo retailer={retailer} size={size}/>; }

/* ─────────────── FILTER COMPONENT ────────────────────────────────────────── */
function OfferFilters({ filters, setFilters, showStarred }) {
  const [open, setOpen] = useState(false);
  const active = Object.values(filters).some(v=>v&&v!=="");
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:open?12:0 }}>
        <Btn outline sm onClick={()=>setOpen(!open)} style={{ borderColor:active?"#0d9488":"#dde",color:active?"#0d9488":"#475569" }}>
          <Filter size={12}/> Filtry {active&&<Badge color="#0d9488" bg="rgba(13,148,136,0.12)">Aktywne</Badge>}
          {open?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
        </Btn>
        {active&&<Btn outline sm onClick={()=>setFilters({ category:"",country:"",cert:"",volumeMin:"",packaging:"",starred:false })} style={{ color:"#dc2626",borderColor:"#dc2626" }}><X size={11}/> Wyczyść</Btn>}
      </div>
      {open&&(
        <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:10,padding:14,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10 }}>
          <div><label style={{ fontSize:11,fontWeight:500,color:"#64748b",display:"block",marginBottom:4 }}>Kategoria</label><select value={filters.category} onChange={e=>setFilters(f=>({...f,category:e.target.value}))} style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit" }}><option value="">Wszystkie</option>{Object.entries(CEMOJI).map(([k,v])=><option key={k} value={k}>{v} {k}</option>)}</select></div>
          <div><label style={{ fontSize:11,fontWeight:500,color:"#64748b",display:"block",marginBottom:4 }}>Kraj</label><select value={filters.country} onChange={e=>setFilters(f=>({...f,country:e.target.value}))} style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit" }}><option value="">Wszystkie</option>{CNAMES_SORTED.map(([k,v])=><option key={k} value={k}>{FLAGS[k]||"🌐"} {v}</option>)}</select></div>
          <div><label style={{ fontSize:11,fontWeight:500,color:"#64748b",display:"block",marginBottom:4 }}>Certyfikat</label><select value={filters.cert} onChange={e=>setFilters(f=>({...f,cert:e.target.value}))} style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit" }}><option value="">Wszystkie</option>{["GlobalGAP","GRASP","BRC","IFS","Bio","FSSC"].map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          <div><label style={{ fontSize:11,fontWeight:500,color:"#64748b",display:"block",marginBottom:4 }}>Opakowanie</label><select value={filters.packaging} onChange={e=>setFilters(f=>({...f,packaging:e.target.value}))} style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit" }}><option value="">Wszystkie</option>{["Bulk","Cartons","IFCO","Flowpack","Punnet"].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={{ fontSize:11,fontWeight:500,color:"#64748b",display:"block",marginBottom:4 }}>Wolumen min. (T)</label><input type="number" value={filters.volumeMin} onChange={e=>setFilters(f=>({...f,volumeMin:e.target.value}))} placeholder="np. 50" style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit",boxSizing:"border-box" }}/></div>
          {showStarred&&<div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:filters.starred?"#fffbeb":"#f8fafc",border:`1px solid ${filters.starred?"#fbbf24":"#e2e8f0"}`,borderRadius:7,cursor:"pointer" }} onClick={()=>setFilters(f=>({...f,starred:!f.starred}))}><Heart size={14} color={filters.starred?"#dc2626":"#94a3b8"} fill={filters.starred?"#dc2626":"none"}/><span style={{ fontSize:12,fontWeight:filters.starred?600:400,color:filters.starred?"#dc2626":"#64748b" }}>Ciekawe</span></div>}
        </div>
      )}
    </div>
  );
}

function applyFilters(offers, filters, starredIds) {
  return offers.filter(o=>{
    if (filters.category && o.category!==filters.category) return false;
    if (filters.country  && o.origin!==filters.country)   return false;
    if (filters.cert     && ![...(o.certs||[]),o.customCert].includes(filters.cert)) return false;
    if (filters.packaging&& ![...(o.packaging||[]),o.customPackaging].includes(filters.packaging)) return false;
    if (filters.volumeMin&& parseFloat(o.volume||0)<parseFloat(filters.volumeMin)) return false;
    if (filters.starred  && starredIds && !starredIds.includes(o.id)) return false;
    return true;
  });
}

/* ─────────────── PREVIEW MODALS ───────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   FM SCHEDULING — DATA & ALGORITHM
═══════════════════════════════════════════════════════════════ */
const CHAIN_TO_RETAILER = {
  "ch5":100, "ch9":103, "ch13":106, "ch2":104, "ch19":110,
  "ch1":0,   "ch3":114, "ch4":114, "ch6":100, "ch7":0,  "ch8":115,
  "ch10":107,"ch11":107,"ch12":0,  "ch14":0,  "ch15":113,
  "ch16":0,  "ch17":112,"ch18":120,"ch20":0,  "ch21":118,
  "ch22":0,  "ch23":0,  "ch24":118,"ch25":0,  "ch26":0,  "ch27":108,
};
// 0 = chain exists in FM but has no matching retailer in Preconnect (privacy: show no offers)
const RETAILER_TO_CHAIN = Object.fromEntries(
  Object.entries(CHAIN_TO_RETAILER).map(([ch, rid]) => [rid, ch])
);
function resolveRetailerIdFromChain(chainId, retailers = []) {
  const row = (retailers || []).find(r => r.fm26ChainId === chainId);
  if (row?.id) return Number(row.id);
  const mapped = CHAIN_TO_RETAILER[chainId];
  if (mapped) return Number(mapped);
  const numeric = Number(chainId);
  return Number.isFinite(numeric) ? numeric : null;
}
function resolveChainIdFromRetailer(retailerId, retailers = [], meta = {}) {
  if (meta?.chain_id) return meta.chain_id;
  if (typeof meta?.note === "string" && meta.note.startsWith("chain:")) return meta.note.slice(6);
  const row = (retailers || []).find(r => Number(r.id) === Number(retailerId) && r.fm26ChainId);
  if (row?.fm26ChainId) return row.fm26ChainId;
  return RETAILER_TO_CHAIN[Number(retailerId)] || null;
}
// [B2B Round 5] Generate a collision-resistant numeric legacy_id (bigint-safe).
// Date.now() alone is unsafe — two clicks within the same ms produce identical
// IDs and the UPSERT silently overwrites. We mix in a 1000-bucket random suffix
// (so two ops within the same ms have <0.1% collision chance) and additionally
// retry against the in-memory `existing` array if the candidate is already used.
function genUniqueLegacyId(existing = []) {
  const used = new Set((existing || []).map(x => x?.id).filter(v => v != null));
  let candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  let attempts = 0;
  while (used.has(candidate) && attempts < 50) {
    candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    attempts++;
  }
  return candidate;
}

// [B2B Round 4.1] Defensive picker: only use savedPlan from Supabase if it has
// the full shape produced by buildFMData (.res + .nums). Otherwise fall back to
// fallbackPlan (typically fmAlgo, which is always well-formed). This protects
// against partially-written / placeholder rows in fm_settings.schedule.
function pickFMPlan(savedPlan, fallbackPlan) {
  return savedPlan && savedPlan.res && savedPlan.nums ? savedPlan : fallbackPlan;
}

// [B2B Round buyer-rejection-fix-1] BUGFIX: priority must keep stars >=1000
// and thumbs <1000 because hydration in App reads:
//   groupedPrefs[supKey][chainKey] = Number(row.priority||0) >= 1000 ? "star" : "thumb"
// Previously this used `base - index` so the 2nd, 3rd... saved star got
// priority 999, 998, ... which loaded back as "thumb". Result: after any
// refresh user ended up with 1 star (or 0 after edits) and the rest sliding
// silently into reserves. Flat priority bands fix this — order within a band
// isn't used by buildFMData (only the star/thumb classification is).
function buildTargetRetailerRowsFromPrefs(prefs = {}, retailers = []) {
  const seen = new Map();
  Object.entries(prefs).forEach(([chainId, pref]) => {
    const retailerId = resolveRetailerIdFromChain(chainId, retailers);
    if (!retailerId) return;
    const priority = pref === "star" ? 1000 : 100;
    const row = { retailer_id: retailerId, priority, note: `chain:${chainId}` };
    const old = seen.get(retailerId);
    if (!old || row.priority > old.priority) seen.set(retailerId, row);
  });
  return Array.from(seen.values());
}
function groupFmWishlists(rows = [], retailers = []) {
  const grouped = {};
  for (const row of rows || []) {
    const chainKey = resolveChainIdFromRetailer(row.retailer_id, retailers, row.data || {});
    if (!chainKey || !row.supplier_legacy_id) continue;
    if (!grouped[chainKey]) grouped[chainKey] = [];
    if (!grouped[chainKey].includes(row.supplier_legacy_id)) grouped[chainKey].push(row.supplier_legacy_id);
  }
  return grouped;
}
function groupFmLateResps(rows = [], retailers = []) {
  const grouped = {};
  for (const row of rows || []) {
    const chainKey = resolveChainIdFromRetailer(row.retailer_id, retailers, row.data || {});
    if (!chainKey || !row.supplier_legacy_id || !row.zone) continue;
    if (!grouped[chainKey]) grouped[chainKey] = {};
    grouped[chainKey][row.supplier_legacy_id] = row.zone;
  }
  return grouped;
}
function getFmThreadKey(userId) {
  return userId ? `user:${userId}` : null;
}
function normalizeFmMessage(row) {
  if (!row) return null;
  const threadUserId =
    row.to_user_id ||
    row.data?.to_user_id ||
    (typeof row.thread_key === "string" && row.thread_key.startsWith("user:") ? row.thread_key.slice(5) : null) ||
    row.from_user_id ||
    null;
  const fromId = row.from_role === "admin" ? "admin" : row.from_user_id;
  const toId = row.to_role === "admin" ? "admin" : threadUserId;
  return {
    id: row.id,
    fromId,
    toId,
    text: row.body || "",
    timestamp: new Date(row.created_at || Date.now()).getTime(),
    read: Boolean(row.read_at),
    fromRole: row.from_role || null,
    toRole: row.to_role || null,
    threadKey: row.thread_key || null,
    toUserId: threadUserId,
  };
}
function sortMessagesChronologically(items = []) {
  return [...(items || [])].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}
function mergeMessage(items = [], nextItem) {
  if (!nextItem) return sortMessagesChronologically(items);
  const map = new Map((items || []).map(m => [String(m.id), m]));
  map.set(String(nextItem.id), nextItem);
  return sortMessagesChronologically(Array.from(map.values()));
}
const BUYER_RESPONSE_VALUES = new Set(["want", "chance", "remove"]);
function hasBuyerResponse(value) {
  return BUYER_RESPONSE_VALUES.has(value);
}
function hasRefundMarker(send) {
  return Boolean(send?.refundAt || send?.refundTxId || send?.refundAmount || send?.data?.refundAt);
}
function getRefundAmount(send) {
  const raw = send?.refundAmount ?? send?.data?.refundAmount ?? send?.price ?? send?.data?.price ?? 0;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}
const FM_CHAINS=[
  {id:"ch1",name:"ARHELAN",country:"PL",cat:"owoce, warzywa"},{id:"ch2",name:"AUCHAN",country:"PL/FR",cat:"owoce, warzywa"},
  {id:"ch3",name:"ALBERT owoce",country:"CZ",cat:"owoce"},{id:"ch4",name:"ALBERT warzywa",country:"CZ",cat:"warzywa"},
  {id:"ch5",name:"BIEDRONKA Import",country:"PL",cat:"import"},{id:"ch6",name:"BIEDRONKA Kraj",country:"PL",cat:"krajowe"},
  {id:"ch7",name:"BINGO",country:"BA",cat:"owoce, warzywa"},{id:"ch8",name:"BILLA",country:"CEE",cat:"owoce, warzywa"},
  {id:"ch9",name:"CARREFOUR",country:"PL/FR",cat:"owoce, warzywa"},{id:"ch10",name:"DINO fruit",country:"PL",cat:"owoce"},
  {id:"ch11",name:"DINO veg",country:"PL",cat:"warzywa"},{id:"ch12",name:"FRAC",country:"PL",cat:"owoce, warzywa"},
  {id:"ch13",name:"INTERMARCHÉ",country:"PL/FR",cat:"owoce, warzywa"},{id:"ch14",name:"NASZ SKLEP",country:"PL",cat:"owoce, warzywa"},
  {id:"ch15",name:"POLOmarket",country:"PL",cat:"owoce, warzywa"},{id:"ch16",name:"ROHLIK",country:"CZ",cat:"owoce, warzywa"},
  {id:"ch17",name:"SELGROS",country:"PL/DE",cat:"owoce, warzywa"},{id:"ch18",name:"SPAR",country:"CEE",cat:"owoce, warzywa"},
  {id:"ch19",name:"STOKROTKA",country:"PL",cat:"owoce, warzywa"},{id:"ch20",name:"TOPAZ",country:"PL",cat:"owoce, warzywa"},
  {id:"ch21",name:"VARUS",country:"UA",cat:"owoce, warzywa"},{id:"ch22",name:"ŻABKA",country:"PL",cat:"owoce"},
  {id:"ch23",name:"DOBRONOM",country:"UA",cat:"owoce, warzywa"},{id:"ch24",name:"ATB",country:"UA",cat:"owoce, warzywa"},
  {id:"ch25",name:"PROFI",country:"RO",cat:"owoce, warzywa"},{id:"ch26",name:"DIONIS",country:"MD/RO",cat:"owoce"},
  {id:"ch27",name:"E.LECLERC",country:"PL/FR",cat:"owoce, warzywa"},
];
const FM_SUPPLIERS=[
  {id:"s1",name:"UNICA GROUP",country:"ES",products:"owoce, cytrusy, winogrona",pkg:"Premium",paymentDate:"2026-08-01"},
  {id:"s2",name:"Hazera Poland",country:"PL/IL",products:"nasiona",pkg:"Premium",paymentDate:"2026-08-02"},
  {id:"s3",name:"FRESH RETAIL PACKING",country:"PL",products:"pakowanie",pkg:"Premium",paymentDate:"2026-08-03"},
  {id:"s4",name:"Bayer",country:"DE/PL",products:"środki ochrony",pkg:"Premium",paymentDate:"2026-08-04"},
  {id:"s5",name:"PIK GLOBAL",country:"PL",products:"warzywa, cytrusy",pkg:"Premium",paymentDate:"2026-08-05"},
  {id:"s6",name:"Fruit Wave",country:"NL",products:"owoce importowane",pkg:"Premium",paymentDate:"2026-08-06"},
  {id:"s7",name:"ON-ZIN",country:"PL",products:"warzywa, grzyby",pkg:"Premium",paymentDate:"2026-08-07"},
  {id:"s8",name:"Agri GeM",country:"PL",products:"warzywa, owoce",pkg:"Premium",paymentDate:"2026-08-08"},
  {id:"s9",name:"EuroVeg",country:"PL",products:"warzywa",pkg:"Business",paymentDate:"2026-08-09"},
  {id:"s10",name:"FHU Rozwój",country:"PL",products:"jabłka",pkg:"Business",paymentDate:"2026-08-10"},
  {id:"s11",name:"Hajduk Grzyby",country:"PL",products:"grzyby",pkg:"Business",paymentDate:"2026-08-11"},
  {id:"s12",name:"Yuksel Tohum",country:"TR/PL",products:"nasiona, pomidory",pkg:"Business",paymentDate:"2026-08-12"},
  {id:"s13",name:"F.H. Nowalijka",country:"PL",products:"warzywa nowalijki",pkg:"Business",paymentDate:"2026-08-13"},
  {id:"s14",name:"FRESH INSIDE",country:"PL",products:"kwiaty, owoce, warzywa",pkg:"Business",paymentDate:"2026-08-14"},
  {id:"s15",name:"Mushroom Business",country:"UA",products:"grzyby",pkg:"Business",paymentDate:"2026-08-15"},
  {id:"s16",name:"NET-PROFIT",country:"PL",products:"warzywa, owoce",pkg:"Business",paymentDate:"2026-08-16"},
  {id:"s17",name:"Fortuna Frutos",country:"ES",products:"cytrusy",pkg:"Business",paymentDate:"2026-08-17"},
  {id:"s18",name:"Fresh Partner",country:"PL",products:"owoce, warzywa",pkg:"Business",paymentDate:"2026-08-18"},
  {id:"s19",name:"Polfarm",country:"PL",products:"warzywa",pkg:"Business",paymentDate:"2026-08-19"},
  {id:"s20",name:"Augma JSC",country:"LT",products:"jagody",pkg:"Business",paymentDate:"2026-08-20"},
  {id:"s21",name:"Valledoro",country:"IT",products:"kiwi",pkg:"Business",paymentDate:"2026-08-21"},
  {id:"s22",name:"Growell",country:"NL",products:"rozsady",pkg:"Business",paymentDate:"2026-08-22"},
  {id:"s23",name:"Sinclair",country:"UK",products:"etykiety",pkg:"Business",paymentDate:"2026-08-23"},
  {id:"s24",name:"WBG-Pooling",country:"DE",products:"opakowania",pkg:"Business",paymentDate:"2026-08-24"},
  {id:"s25",name:"DULCINEA",country:"ES",products:"melony, arbuzy",pkg:"Business",paymentDate:"2026-08-25"},
  {id:"s26",name:"West Food",country:"PL",products:"warzywa",pkg:"Business",paymentDate:"2026-08-26"},
  {id:"s27",name:"Cartama Europe",country:"NL/ES",products:"awokado, mango",pkg:"Business",paymentDate:"2026-08-27"},
  {id:"s28",name:"Green Organics",country:"PL",products:"owoce eko",pkg:"Business",paymentDate:"2026-08-28"},
  {id:"s29",name:"POLISH GARLIC",country:"PL",products:"czosnek",pkg:"Business",paymentDate:"2026-08-29"},
  {id:"s30",name:"Schrijvershof",country:"NL",products:"pomidory",pkg:"Business",paymentDate:"2026-08-30"},
];
const FM_PHASES=[
  {id:1,label:"Rejestracja",         sub:"Sieci potwierdzają udział w FM 2026",                         dates:"wrzesień 2026",       color:"#7c3aed"},
  {id:2,label:"Preferencje",         sub:"Dostawcy i kupcy wybierają partnerów (do 16 września)",        dates:"1–16 września",       color:"#2563eb"},
  {id:3,label:"Algorytm + Korekty",  sub:"Admin uruchamia algorytm i koryguje plan (17–21 września)",    dates:"17–21 września",      color:"#0d9488"},
  {id:4,label:"Publikacja i event",  sub:"Finalna lista 22 wrz. · Event 24 wrz.",                        dates:"22–24 września",      color:"#059669"},
];
const FM_MAX_M=5,FM_MAX_S=60;
// runFMAlgo removed — buildFMData is canonical
function genFMData(suppliers, chains){
  const _s = (suppliers && suppliers.length > 0) ? suppliers : FM_SUPPLIERS;
  const _c = (chains    && chains.length    > 0) ? chains    : FM_CHAINS;
  const p={},r={};_c.forEach(c=>{r[c.id]={};});
  _s.forEach(s=>{const sh=[..._c].sort(()=>Math.random()-0.5);p[s.id]={};sh.slice(0,5).forEach(c=>{p[s.id][c.id]="star";});sh.slice(5,5+3+Math.floor(Math.random()*5)).forEach(c=>{p[s.id][c.id]="thumb";});});
  _s.forEach(s=>{_c.forEach(c=>{if(p[s.id]?.[c.id]){const x=Math.random();r[c.id][s.id]=x<0.40?"want":x<0.78?"chance":"remove";}});});
  return{p,r};
}
function getFMZone(pos){if(pos==null)return"blocked";if(pos<=25)return"green";if(pos<=35)return"orange";return"red";}
const FM_ZONE_COLORS={
  green: {c:"#059669",bg:"#f0fdf4",b:"#bbf7d0",l:"Wysoka szansa",i:"🟢"},
  orange:{c:"#d97706",bg:"#fffbeb",b:"#fde68a",l:"Środkowa kolejka",i:"🟠"},
  red:   {c:"#dc2626",bg:"#fee2e2",b:"#fca5a5",l:"Jeśli wolny czas",i:"🔴"},
  blocked:{c:"#64748b",bg:"#f8fafc",b:"#e2e8f0",l:"Brak dopasowania",i:"⛔"},
};
const _fmInitData = genFMData();

/* ─────────────── KONTA DEMO — wszystkie firmy FM ───────────────────────── */
/* ─────────────── COMPANIES_DB — jedna baza firm testowych ──────────────── */
const COMPANIES_DB = [
  {
    id:"sup-s1", fmId:"s1",
    name:"UNICA GROUP", nip:"ES-B-12345678", country:"ES", city:"Almería",
    phone:"+34 950 123 456", website:"https://unicagroup.es",
    description:"Producent i eksporter owoców z Hiszpanii. Własne sady 800 ha w Walencji. Certyfikaty GlobalGAP i BRC.",
    types:["producent","eksporter"], categories:["owoce"],
    products:"cytrusy, winogrona, owoce pestkowe", seasonality:"X-III",
    markets:"PL, DE, CEE", completeness:92, logo:null, pdfs:[],
    contacts:[
      {role:"sales",   name:"María García",  position:"Export Manager",  phone:"+34 950 123 456", email:"sales@unicagroup.es"},
      {role:"quality", name:"Carlos López",  position:"Quality Manager", phone:"+34 950 123 457", email:"quality@unicagroup.es"}
    ],
    certs:[
      {type:"GlobalGAP", number:"GP-UNICA-2026", valid:"2026-12-31"},
      {type:"BRC",       number:"BRC-UNICA-2024", valid:"2026-10-31"}
    ],
    pkg:"prem_10", pkgExpiry:"2026-12-31", paymentDate:"2026-08-01",
  },
  {
    id:"sup-s5", fmId:"s5",
    name:"PIK GLOBAL", nip:"PL7891234567", country:"PL", city:"Warszawa",
    phone:"+48 22 456 7890", website:"https://pikglobal.pl",
    description:"Polski eksporter warzyw i cytrusów. Własna sortownia i chłodnia. Dostawy retail-ready do CEE.",
    types:["eksporter","pakowalnia"], categories:["warzywa","owoce"],
    products:"warzywa sezonowe, cytrusy importowane", seasonality:"IV-XI",
    markets:"PL, CZ, SK", completeness:88, logo:null, pdfs:[],
    contacts:[
      {role:"sales",   name:"Piotr Kowalski", position:"Export Manager",  phone:"+48 22 456 7890", email:"sales@pikglobal.pl"},
      {role:"quality", name:"Anna Nowak",      position:"Quality Manager", phone:"+48 22 456 7891", email:"quality@pikglobal.pl"}
    ],
    certs:[{type:"GlobalGAP", number:"GP-PIK-2026", valid:"2026-12-31"}],
    pkg:"std_10", pkgExpiry:"2026-12-31", paymentDate:"2026-08-05",
  },
  {
    id:"sup-s14", fmId:"s14",
    name:"FRESH INSIDE", nip:"PL5678901234", country:"PL", city:"Poznań",
    phone:"+48 61 234 5678", website:"https://freshinside.pl",
    description:"Importer i dystrybutor kwiatów ciętych oraz owoców z Holandii i Kenii. Bezpośredni import z FloraHolland.",
    types:["importer","eksporter"], categories:["kwiaty","owoce"],
    products:"kwiaty cięte, owoce tropikalne", seasonality:"cały rok",
    markets:"PL, DE, NL", completeness:85, logo:null, pdfs:[],
    contacts:[
      {role:"sales", name:"Karolina Wiśniewska", position:"Export Manager", phone:"+48 61 234 5678", email:"sales@freshinside.pl"}
    ],
    certs:[
      {type:"GlobalGAP", number:"GP-FI-2026",  valid:"2026-12-31"},
      {type:"MPS-ABC",   number:"MPS-FI-2024", valid:"2026-08-31"}
    ],
    pkg:"prem_10", pkgExpiry:"2026-12-31", paymentDate:"2026-08-14",
  },
  {id:"sup-s2",fmId:"s2",name:"Hazera Poland",nip:"PL1234560001",country:"PL",city:"Warszawa",phone:"+48 22 111 2233",website:"https://hazera.pl",description:"Dostawca nasion warzyw i ziół do sieci handlowych. Specjalizacja w odmianach F1 dla upraw szklarniowych i polowych.",types:["producent"],categories:["warzywa"],products:"nasiona warzyw F1, odmiany sałat, pomidorów, papryki",seasonality:"cały rok",markets:"PL, CZ, SK",completeness:72,logo:null,pdfs:[],contacts:[{role:"sales",name:"Katarzyna Bąk",position:"Sales Manager",phone:"+48 22 111 2233",email:"sales@hazera.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s3",fmId:"s3",name:"FRESH RETAIL PACKING",nip:"PL9876500001",country:"PL",city:"Grodzisk Mazowiecki",phone:"+48 22 333 4455",website:"https://freshretailpacking.pl",description:"Specjalistyczna pakowalnia owoców i warzyw dla sieci handlowych. Linie retail-ready, etykietowanie, flow-pack.",types:["pakowalnia"],categories:["owoce","warzywa"],products:"pakowanie warzyw i owoców, flow-pack, tacki",seasonality:"cały rok",markets:"PL, CEE",completeness:80,logo:null,pdfs:[],contacts:[{role:"sales",name:"Marcin Zając",position:"Export Manager",phone:"+48 22 333 4455",email:"sales@freshretailpacking.pl"}],certs:[],pkg:"prem_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s4",fmId:"s4",name:"Bayer CropScience",nip:"DE0000000001",country:"DE",city:"Monheim am Rhein",phone:"+49 2173 380000",website:"https://bayer.com/cropscience",description:"Środki ochrony roślin i biostymulatory dla producentów owoców i warzyw. Produkty dopuszczone do stosowania w UE.",types:["producent"],categories:["warzywa","owoce"],products:"środki ochrony roślin, biostymulatory, fungicydy",seasonality:"cały rok",markets:"PL, DE, CEE",completeness:88,logo:null,pdfs:[],contacts:[{role:"sales",name:"Klaus Müller",position:"Regional Sales Manager",phone:"+49 2173 380001",email:"cropscience@bayer.com"}],certs:[],pkg:"prem_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s6",fmId:"s6",name:"Fruit Wave",nip:"NL0000000001",country:"NL",city:"Rotterdam",phone:"+31 10 123 4567",website:"https://fruitwave.nl",description:"Holenderski importer i dystrybutor owoców tropikalnych i egzotycznych. Bezpośredni import z Ameryki Południowej i Afryki.",types:["importer","eksporter"],categories:["owoce"],products:"avokado, mango, ananasy, papaja, owoce tropikalne",seasonality:"cały rok",markets:"PL, DE, NL, CEE",completeness:85,logo:null,pdfs:[],contacts:[{role:"sales",name:"Erik van den Berg",position:"Export Manager",phone:"+31 10 123 4567",email:"sales@fruitwave.nl"}],certs:[],pkg:"prem_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s7",fmId:"s7",name:"ON-ZIN",nip:"PL5555500001",country:"PL",city:"Lublin",phone:"+48 81 222 3344",website:"https://on-zin.pl",description:"Polski producent warzyw sezonowych i grzybów. Własne uprawy w województwie lubelskim, dostawa BIO na zamówienie.",types:["producent"],categories:["warzywa"],products:"warzywa sezonowe, pieczarki, boczniaki, grzyby leśne",seasonality:"IV-XI",markets:"PL, UA",completeness:68,logo:null,pdfs:[],contacts:[{role:"sales",name:"Zbigniew Kwiatkowski",position:"Kierownik Sprzedaży",phone:"+48 81 222 3344",email:"sprzedaz@on-zin.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s8",fmId:"s8",name:"Agri GeM",nip:"PL4444400001",country:"PL",city:"Sandomierz",phone:"+48 15 333 4455",website:"https://agrigem.pl",description:"Producent i eksporter owoców i warzyw z regionu sandomierskiego. Specjalizacja w jabłkach i warzywach korzeniowych.",types:["producent","eksporter"],categories:["owoce","warzywa"],products:"jabłka, marchew, pietruszka, seler",seasonality:"VIII-III",markets:"PL, CZ, SK, DE",completeness:74,logo:null,pdfs:[],contacts:[{role:"sales",name:"Tomasz Grześkiewicz",position:"Export Manager",phone:"+48 15 333 4455",email:"export@agrigem.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s9",fmId:"s9",name:"EuroVeg",nip:"PL3333300001",country:"PL",city:"Poznań",phone:"+48 61 444 5566",website:"https://euroveg.pl",description:"Producent i eksporter warzyw świeżych. Certyfikowane uprawy, dostawa do sieci handlowych w całej Europie.",types:["producent","eksporter"],categories:["warzywa"],products:"kapusta, cebula, por, kalafior, brokuł",seasonality:"V-XI",markets:"PL, DE, NL, UK",completeness:77,logo:null,pdfs:[],contacts:[{role:"sales",name:"Paweł Wiśniewski",position:"Export Director",phone:"+48 61 444 5566",email:"export@euroveg.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s10",fmId:"s10",name:"FHU Rozwój",nip:"PL2222200001",country:"PL",city:"Grójec",phone:"+48 48 555 6677",website:"https://fhurozwoj.pl",description:"Sadownik z Grójca — największego zagłębia jabłkowego w Polsce. Eksport jabłek do 15 krajów UE i pozaunijnych.",types:["producent","eksporter"],categories:["owoce"],products:"jabłka odmian: Gala, Jonagold, Fuji, Ligol",seasonality:"VIII-III",markets:"PL, DE, UK, CEE",completeness:71,logo:null,pdfs:[],contacts:[{role:"sales",name:"Robert Krawczyk",position:"Właściciel",phone:"+48 48 555 6677",email:"biuro@fhurozwoj.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s11",fmId:"s11",name:"Hajduk Grzyby",nip:"PL1111100001",country:"PL",city:"Biała Podlaska",phone:"+48 83 666 7788",website:"https://hajdukgrzyby.pl",description:"Producent i eksporter grzybów uprawnych i leśnych. Pieczarki, boczniaki, shiitake, grzyby suszone.",types:["producent","eksporter"],categories:["warzywa"],products:"pieczarki, boczniaki, shiitake, grzyby suszone",seasonality:"cały rok",markets:"PL, DE, UA",completeness:66,logo:null,pdfs:[],contacts:[{role:"sales",name:"Adam Hajduk",position:"Dyrektor",phone:"+48 83 666 7788",email:"sprzedaz@hajdukgrzyby.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s12",fmId:"s12",name:"Yuksel Tohum",nip:"TR0000000001",country:"TR",city:"Antalya",phone:"+90 242 123 4567",website:"https://yukselseeds.com.tr",description:"Turecki producent nasion warzyw i pomidorów. Odmiany testowane w warunkach śródziemnomorskich, eksport do całej Europy.",types:["producent"],categories:["warzywa"],products:"nasiona pomidorów, papryki, ogórka, bakłażana",seasonality:"cały rok",markets:"PL, TR, DE, CEE",completeness:70,logo:null,pdfs:[],contacts:[{role:"sales",name:"Mehmet Yuksel",position:"Export Manager",phone:"+90 242 123 4567",email:"sales@yukselseeds.com.tr"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s13",fmId:"s13",name:"F.H. Nowalijka",nip:"PL9999900001",country:"PL",city:"Kraków",phone:"+48 12 777 8899",website:"https://nowalijka.pl",description:"Specjalista w dostawach nowalijek i warzyw szklarniowych do sieci handlowych. Lokalni dostawcy, krótki łańcuch dostaw.",types:["producent","eksporter"],categories:["warzywa"],products:"rzodkiewka, szczypiorek, sałata masłowa, szpinak, roszponka",seasonality:"III-VI",markets:"PL",completeness:65,logo:null,pdfs:[],contacts:[{role:"sales",name:"Monika Nowak",position:"Kierownik",phone:"+48 12 777 8899",email:"sprzedaz@nowalijka.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s15",fmId:"s15",name:"Mushroom Business",nip:"UA0000000001",country:"UA",city:"Lwów",phone:"+380 32 123 4567",website:"https://mushroombusiness.ua",description:"Ukraiński producent i eksporter grzybów. Nowoczesne pieczarkarnie, certyfikaty EU, dostawa chłodnicza.",types:["producent","eksporter"],categories:["warzywa"],products:"pieczarki brązowe i białe, boczniaki",seasonality:"cały rok",markets:"PL, DE, CZ",completeness:63,logo:null,pdfs:[],contacts:[{role:"sales",name:"Oleksiy Kovalenko",position:"Export Manager",phone:"+380 32 123 4567",email:"export@mushroombusiness.ua"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s16",fmId:"s16",name:"NET-PROFIT",nip:"PL8888800001",country:"PL",city:"Wrocław",phone:"+48 71 888 9900",website:"https://net-profit.pl",description:"Dystrybutor warzyw i owoców dla sieci handlowych. Własna flota chłodnicza, dostawa w 24h na terenie całej Polski.",types:["eksporter","importer"],categories:["warzywa","owoce"],products:"mieszanka warzywna, owoce sezonowe, dostawy just-in-time",seasonality:"cały rok",markets:"PL",completeness:73,logo:null,pdfs:[],contacts:[{role:"sales",name:"Łukasz Kowalski",position:"Dyrektor Handlowy",phone:"+48 71 888 9900",email:"handel@net-profit.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s17",fmId:"s17",name:"Fortuna Frutos",nip:"ES-B-99999999",country:"ES",city:"Valencia",phone:"+34 963 111 222",website:"https://fortunafrutos.es",description:"Eksporter cytrusów z Walencji. Pomarańcze, mandarynki, cytryny z certyfikatem GlobalGAP, program stały X–III.",types:["producent","eksporter"],categories:["owoce"],products:"pomarańcze, mandarynki, cytryny, grejpfruty",seasonality:"X-III",markets:"PL, DE, UK, CEE",completeness:82,logo:null,pdfs:[],contacts:[{role:"sales",name:"Carlos Martínez",position:"Export Manager",phone:"+34 963 111 222",email:"export@fortunafrutos.es"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s18",fmId:"s18",name:"Fresh Partner",nip:"PL7777700001",country:"PL",city:"Łódź",phone:"+48 42 999 0011",website:"https://freshpartner.pl",description:"Importer i eksporter owoców i warzyw dla retail. Obsługa sieci handlowych, private label, program sezonowy.",types:["importer","eksporter"],categories:["owoce","warzywa"],products:"owoce cytrusowe, jabłka, winogrona, warzywa korzeniowe",seasonality:"cały rok",markets:"PL, CZ, SK",completeness:76,logo:null,pdfs:[],contacts:[{role:"sales",name:"Agnieszka Kamińska",position:"Key Account Manager",phone:"+48 42 999 0011",email:"sprzedaz@freshpartner.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s19",fmId:"s19",name:"Polfarm",nip:"PL6666600001",country:"PL",city:"Lublin",phone:"+48 81 234 5670",website:"https://polfarm.pl",description:"Producent warzyw z województwa lubelskiego. Własne pola, certyfikowane uprawy, dostawa do dystrybucji centralnej.",types:["producent"],categories:["warzywa"],products:"pomidory, ogórki, papryka, cukinia",seasonality:"V-X",markets:"PL",completeness:67,logo:null,pdfs:[],contacts:[{role:"sales",name:"Andrzej Wróbel",position:"Handlowiec",phone:"+48 81 234 5670",email:"sprzedaz@polfarm.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s20",fmId:"s20",name:"Augma JSC",nip:"LT0000000001",country:"LT",city:"Vilnius",phone:"+370 5 123 4567",website:"https://augma.lt",description:"Litewski producent i eksporter jagód leśnych i uprawnych. Borówka, malina, truskawka, aronia — mrożona i świeża.",types:["producent","eksporter"],categories:["owoce"],products:"borówka, malina, truskawka, aronia, porzeczka",seasonality:"VI-IX",markets:"PL, DE, NL, UK",completeness:79,logo:null,pdfs:[],contacts:[{role:"sales",name:"Marius Žukauskas",position:"Export Director",phone:"+370 5 123 4567",email:"export@augma.lt"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s21",fmId:"s21",name:"Valledoro",nip:"IT0000000001",country:"IT",city:"Latina",phone:"+39 0773 123 456",website:"https://valledoro.it",description:"Włoski producent i eksporter kiwi z regionu Lacjum. Odmiany Hayward i Yellow Gold, program stały XI–IV.",types:["producent","eksporter"],categories:["owoce"],products:"kiwi Hayward, kiwi Yellow Gold",seasonality:"XI-IV",markets:"PL, DE, CEE",completeness:78,logo:null,pdfs:[],contacts:[{role:"sales",name:"Marco Rossi",position:"Export Manager",phone:"+39 0773 123 456",email:"export@valledoro.it"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s22",fmId:"s22",name:"Growell",nip:"NL0000000002",country:"NL",city:"Naaldwijk",phone:"+31 174 123 456",website:"https://growell.nl",description:"Holenderski producent rozsad warzyw szklarniowych. Pomidory, papryka, ogórki — gotowe rozsady dla producentów.",types:["producent"],categories:["warzywa"],products:"rozsady pomidorów, papryki, ogórka, sałat",seasonality:"I-IV",markets:"PL, DE, NL",completeness:69,logo:null,pdfs:[],contacts:[{role:"sales",name:"Jan de Vries",position:"Sales Manager",phone:"+31 174 123 456",email:"info@growell.nl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s23",fmId:"s23",name:"Sinclair",nip:"GB0000000001",country:"GB",city:"Bristol",phone:"+44 117 123 4567",website:"https://sinclairproduce.com",description:"Brytyjski dostawca etykiet i rozwiązań traceability dla producentów owoców. Etykiety PLU, EAN, promotyczne.",types:["eksporter"],categories:["owoce","warzywa"],products:"etykiety PLU, EAN, druk cyfrowy, traceability",seasonality:"cały rok",markets:"PL, DE, UK, CEE",completeness:72,logo:null,pdfs:[],contacts:[{role:"sales",name:"James Wilson",position:"European Sales",phone:"+44 117 123 4567",email:"europe@sinclairproduce.com"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s24",fmId:"s24",name:"WBG-Pooling",nip:"DE0000000002",country:"DE",city:"Frankfurt",phone:"+49 69 123 4567",website:"https://wbg-pooling.de",description:"Dostawca opakowań i systemu poolingowego do logistyki owoców i warzyw. Skrzynki, palety, pojemniki wielokrotne.",types:["eksporter"],categories:["owoce","warzywa"],products:"skrzynki plastikowe poolingowe, pojemniki transportowe",seasonality:"cały rok",markets:"PL, DE, CEE",completeness:64,logo:null,pdfs:[],contacts:[{role:"sales",name:"Thomas Becker",position:"Pooling Coordinator",phone:"+49 69 123 4567",email:"pooling@wbg.de"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s25",fmId:"s25",name:"DULCINEA",nip:"ES-B-11111111",country:"ES",city:"Almería",phone:"+34 950 234 567",website:"https://dulcinea.es",description:"Eksporter melonów i arbuzów z Almería. Odmiany premium Sprite i Tuscan, program stały VI–IX dla sieci retail.",types:["producent","eksporter"],categories:["owoce"],products:"melony Sprite, Piel de Sapo, arbuzy bezpestkowe",seasonality:"VI-IX",markets:"PL, DE, UK, CEE",completeness:81,logo:null,pdfs:[],contacts:[{role:"sales",name:"Ana García Ruiz",position:"Export Manager",phone:"+34 950 234 567",email:"export@dulcinea.es"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s26",fmId:"s26",name:"West Food",nip:"PL5551100001",country:"PL",city:"Opole",phone:"+48 77 345 6789",website:"https://westfood.pl",description:"Producent i dystrybutor warzyw na rynek krajowy i eksport. Specjalizacja w kapuście białej, czerwonej i kiszonej.",types:["producent","eksporter"],categories:["warzywa"],products:"kapusta biała, czerwona, kiszona, kiszone ogórki",seasonality:"VII-XII",markets:"PL, DE",completeness:66,logo:null,pdfs:[],contacts:[{role:"sales",name:"Krzysztof Malinowski",position:"Dyrektor Sprzedaży",phone:"+48 77 345 6789",email:"handel@westfood.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s27",fmId:"s27",name:"Cartama Europe",nip:"NL0000000003",country:"NL",city:"Amsterdam",phone:"+31 20 123 4567",website:"https://cartama.eu",description:"Import i dystrybucja awokado i mango z Ameryki Południowej i Afryki. Własne dojrzewalnie, dostawa RIPE.",types:["importer","eksporter"],categories:["owoce"],products:"awokado Hass, mango Tommy Atkins, Kent",seasonality:"cały rok",markets:"PL, DE, NL, CEE",completeness:83,logo:null,pdfs:[],contacts:[{role:"sales",name:"Sophie Laurent",position:"Sales Europe",phone:"+31 20 123 4567",email:"sales@cartama.eu"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s28",fmId:"s28",name:"Green Organics",nip:"PL4441100001",country:"PL",city:"Gdańsk",phone:"+48 58 456 7890",website:"https://greenorganics.pl",description:"Producent i dystrybutor owoców ekologicznych. Certyfikat EU BIO, własne sady i dostawcy kontraktowi.",types:["producent","eksporter"],categories:["owoce"],products:"jabłka BIO, gruszki BIO, jagody BIO, mix owoców eko",seasonality:"VIII-II",markets:"PL, DE, NL",completeness:76,logo:null,pdfs:[],contacts:[{role:"sales",name:"Natalia Zielińska",position:"Export Manager",phone:"+48 58 456 7890",email:"export@greenorganics.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s29",fmId:"s29",name:"POLISH GARLIC",nip:"PL3331100001",country:"PL",city:"Kielce",phone:"+48 41 567 8901",website:"https://polishgarlic.pl",description:"Eksporter polskiego czosnku do sieci handlowych w całej Europie. Czosnek pleciony, luzem i konfekcjonowany.",types:["producent","eksporter"],categories:["warzywa"],products:"czosnek biały, czosnek różowy, czosnek suszony",seasonality:"VII-XII",markets:"PL, DE, UK, FR",completeness:74,logo:null,pdfs:[],contacts:[{role:"sales",name:"Jacek Szymański",position:"Export Director",phone:"+48 41 567 8901",email:"export@polishgarlic.pl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},
  {id:"sup-s30",fmId:"s30",name:"Schrijvershof",nip:"NL0000000004",country:"NL",city:"Breda",phone:"+31 76 123 4567",website:"https://schrijvershof.nl",description:"Holenderski producent pomidorów szklarniowych. Pomidory malinowe, cherry, koktajlowe. Certyfikat GlobalGAP.",types:["producent"],categories:["warzywa"],products:"pomidory malinowe, cherry, koktajlowe, grape",seasonality:"cały rok",markets:"PL, DE, NL, UK",completeness:84,logo:null,pdfs:[],contacts:[{role:"sales",name:"Pieter Schrijver",position:"Export Manager",phone:"+31 76 123 4567",email:"export@schrijvershof.nl"}],certs:[],pkg:"std_10",pkgExpiry:"2026-12-31"},];

/* helper used by buyer/admin panels */
// [B2B Round 5.5] Single source of truth for "does this supplier-key string
// belong to this company row?". Round 5 introduced 4 possible representations:
//   - company UUID (legacy default)
//   - legacy_supplier_id ("sup-codex-silvicola") — the post-Round-5 canonical
//   - fmId ("s1" / "s5") — FM 2026 matching id
//   - "sup-<fmId>" ("sup-s1") — pre-Round-2.5 seed format
// All filter sites that compare offer/send.supplierId against a company must
// use this helper so they survive the migration.
function legacyKeyMatchesCompany(key, co) {
  if (!key || !co) return false;
  return (
    key === co.id ||
    key === co.legacy_supplier_id ||
    key === co.fmId ||
    key === ("sup-" + (co.fmId || ""))
  );
}

// [B2B Round 5.4] After Round 5, offers.supplierId stores legacy_supplier_id
// (e.g. "sup-codex-silvicola") so the supplier_legacy_id RLS check passes on
// INSERT. The resolver must therefore match against c.legacy_supplier_id (DB
// JOIN field), not just c.id (UUID). Without this, every newly-saved offer
// rendered to buyer/admin showed "Food Market" (COMPANY_INIT fallback) instead
// of the real supplier name.
function getSupplierCo(send, offers, companies) {
  const co = companies || [];
  const offer = getOffer(send?.offerId, offers);
  const sid = offer?.supplierId;
  if (!sid) return COMPANY_INIT;
  return co.find(c => legacyKeyMatchesCompany(sid, c)) || COMPANY_INIT;
}

/* ─────────────── KONTA DEMO — wszystkie firmy FM ───────────────────────── */
function makeCoFromFMSupplier(s, companies) {
  if(!s) return COMPANY_INIT;
  const co = companies || [];
  return co.find(c=>c.id==="sup-"+s.id) || COMPANY_INIT;
}




/* ─────────────── FM ROUTE HELPER ──────────────────────────────────────────── */
/* Maps current FM phase to the correct sub-page route for supplier */
function resolveFMRoute(fmSettings) {
  if (!fmSettings.schedulingOpen) return "fm-sched"; // will show lock screen
  const phase = fmSettings.currentPhase;
  const pub   = fmSettings.planPublished;
  if (pub || phase >= 5) return "fm-wyniki";   // finalna lista / event
  if (phase >= 3)        return "fm-algo";     // algorytm matchingu (admin-only work phase)
  return "fm-sched";                            // preferencje (phase 1-2)
}

/* ─────────────── MAIN APP ─────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════
   APP – new 5/4-item nav structure
══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   KNOWLEDGE BASE — baza wiedzy do asystenta AI w czacie admina
══════════════════════════════════════════════════════════════════════════ */
const KNOWLEDGE_BASE = [
  {
    keywords: ["korekt", "zmieni", "zmienić", "zamieni", "zamienić", "popraw", "poprawić", "przenieś", "przeniesc"],
    answer: "Wybory partnerów FM można zmieniać do 16 września 2026. Po tym terminie wybory są zamknięte i plan układa administrator. Jeśli chcesz zgłosić zmianę po zamknięciu, napisz do administratora przez Chat — Oksana Kozłowska odpowie najszybciej jak to możliwe."
  },
  {
    keywords: ["kiedy", "zaplacic", "zapłacić", "zwrot", "pieniadze", "pieniądze", "portfel", "token", "koszt", "cena", "ile"],
    answer: "W ramach systemu PreConnect gwarantujemy, że kupiec zapozna się z Twoją propozycją. Jeśli nie otworzy jej w ciągu 14 dni, pobrana kwota automatycznie wróci na Twój wirtualny portfel w postaci tokenów na kolejne wysyłki."
  },
  {
    keywords: ["algorytm", "jak działa", "jak przydziela", "spotkania", "numer", "numerek", "kolejka", "matching"],
    answer: "Algorytm matchingu Fresh Market działa w 3 rundach: najpierw wzajemne dopasowania (⭐+✅), potem gwiazdki z szansą, na końcu rezerwy. Scheduling przydziela numery kolejkowe tak, żeby firmy Premium miały spotkania w slotach 1–20, a Business pierwsze w 1–10, drugie w 11–20."
  },
  {
    keywords: ["preferencje", "wybrać", "wybrac", "sieć", "sieci", "gwiazdka", "gwiazda", "rezerwow", "rezerwowa", "rezerwę"],
    answer: "Do 16 września 2026 możesz wybierać sieci handlowe (⭐ główne, max 5) i dowolną liczbę rezerwowych (👍). Możesz też zmieniać odpowiedzi dowolną ilość razy. Po zamknięciu zmian jedyną drogą jest kontakt z administratorem przez Chat."
  },
  {
    keywords: ["pakiet", "premium", "business", "standard", "plan", "kupic", "kupić"],
    answer: "Dostępne pakiety to Premium (10 wysyłek, sloty 1–20 w FM) oraz Business (10 wysyłek, sloty 1–10 i 11–20). Pakiet możesz dokupić w zakładce Finanse. Po zakupie wysyłki są ważne do końca roku pakietowego."
  },
  {
    keywords: ["harmonogram", "plan spotkań", "kiedy", "data", "wrzesień", "termin", "event", "targ", "targi"],
    answer: "Fresh Market 2026 odbędzie się 24 września w Ożarowie Mazowieckim. Plan spotkań (z numerami kolejkowymi) zostanie opublikowany przez administratora 22 września po zakończeniu Fazy Korekt."
  },
  {
    keywords: ["kontakt", "telefon", "email", "oksana", "administrator", "pomoc", "problem", "blad", "błąd"],
    answer: "W sprawach pilnych możesz skontaktować się bezpośrednio z administratorem: Oksana Kozłowska · oksana@freshmarket.eu · +48 603 811 818. Staramy się odpowiadać w ciągu 24 godzin roboczych."
  },
];

function getAiAnswer(text) {
  const normalized = text.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9 ]/g, " ");
  for (const entry of KNOWLEDGE_BASE) {
    if (entry.keywords.some(kw => normalized.includes(kw.normalize("NFD").replace(/[̀-ͯ]/g, "")))) {
      return entry.answer;
    }
  }
  return "Dzień dobry! Przekazuję to zapytanie do naszego zespołu. Wrócę z odpowiedzią najszybciej jak to możliwe. W pilnych sprawach zapraszam do kontaktu: oksana@freshmarket.eu · +48 603 811 818.";
}


/* ══════════════════════════════════════════════════════════════════════════
   FLOATING CHAT — pływający dymek dla dostawców i kupców
══════════════════════════════════════════════════════════════════════════ */
function FloatingChat({ account, messages, onSendMessage, onMarkThreadRead }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  const myId = account.id;
  const thread = messages.filter(m =>
    (m.fromId === myId && m.toId === "admin") ||
    (m.fromId === "admin" && m.toId === myId)
  ).sort((a,b) => a.timestamp - b.timestamp);

  const unread = thread.filter(m => m.fromId === "admin" && !m.read).length;

  // Mark admin messages as read when opening chat
  async function handleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && typeof onMarkThreadRead === "function") {
      await onMarkThreadRead(myId, account.role);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    const saved = await onSendMessage?.(t);
    if (saved) setText("");
  }

  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }

  useEffect(() => {
    if (open && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [open, thread.length]);

  const roleName = account.role === "supplier" ? "Dostawca" : "Sieć";

  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:3000 }}>
      {open && (
        <div style={{ position:"absolute", bottom:60, right:0, width:320, background:"white", borderRadius:14, boxShadow:"0 8px 40px rgba(0,0,0,0.18)", border:"1px solid #e2e8f0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Header */}
          <div style={{ background:"#0d9488", padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:16 }}>🍎</span>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:"white", fontWeight:700, fontSize:13 }}>Fresh Market Support</div>
              <div style={{ color:"rgba(255,255,255,0.75)", fontSize:11 }}>Oksana Kozłowska · Admin</div>
            </div>
            <button onClick={()=>setOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.7)", padding:2 }}><X size={16}/></button>
          </div>
          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 14px", display:"flex", flexDirection:"column", gap:8, maxHeight:320, minHeight:180, background:"#f8fafc" }}>
            {thread.length === 0 && (
              <div style={{ textAlign:"center", color:"#94a3b8", fontSize:12, padding:"20px 0" }}>
                Wyślij wiadomość do administratora.<br/>Odpowiemy najszybciej jak to możliwe.
              </div>
            )}
            {thread.map(m => {
              const isMe = m.fromId === myId;
              return (
                <div key={m.id} style={{ display:"flex", justifyContent:isMe?"flex-end":"flex-start" }}>
                  <div style={{ maxWidth:"80%", padding:"8px 12px", borderRadius:isMe?"12px 12px 2px 12px":"12px 12px 12px 2px", background:isMe?"#0d9488":"white", color:isMe?"white":"#1e293b", fontSize:12, lineHeight:1.5, boxShadow:"0 1px 3px rgba(0,0,0,0.08)", border:isMe?"none":"1px solid #e2e8f0" }}>
                    {m.text}
                    <div style={{ fontSize:9, opacity:0.6, marginTop:2, textAlign:"right" }}>
                      {new Date(m.timestamp).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef}/>
          </div>
          {/* Input */}
          <div style={{ padding:"10px 12px", borderTop:"1px solid #e2e8f0", display:"flex", gap:8, background:"white" }}>
            <textarea
              value={text} onChange={e=>setText(e.target.value)} onKeyDown={onKey}
              placeholder="Napisz wiadomość... (Enter = wyślij)"
              rows={2}
              style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12, fontFamily:"inherit", resize:"none", outline:"none", background:"#f8fafc" }}
            />
            <button onClick={()=>void send()} disabled={!text.trim()} style={{ padding:"8px 12px", borderRadius:8, background:text.trim()?"#0d9488":"#e2e8f0", color:text.trim()?"white":"#94a3b8", border:"none", cursor:text.trim()?"pointer":"default", display:"flex", alignItems:"center" }}>
              <SendIcon size={14}/>
            </button>
          </div>
        </div>
      )}
      {/* Bubble button */}
      <button onClick={handleOpen} style={{ width:50, height:50, borderRadius:"50%", background:"#0d9488", border:"none", cursor:"pointer", boxShadow:"0 4px 16px rgba(13,148,136,0.4)", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", transition:"transform 0.15s" }}>
        <MessageCircle size={22} color="white"/>
        {unread > 0 && !open && (
          <span style={{ position:"absolute", top:0, right:0, background:"#dc2626", color:"white", borderRadius:"50%", fontSize:9, fontWeight:700, width:18, height:18, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid white" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE ADMIN CHAT — widok administratora z listą wątków i oknem rozmowy
══════════════════════════════════════════════════════════════════════════ */
function PageAdminChat({ messages, runtimeAccounts, onSendReply, onMarkThreadRead, onSuggestReply }) {
  const [selectedId, setSelectedId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const bottomRef = useRef(null);

  // Build thread list: unique participants who messaged admin
  const participants = useMemo(() => {
    const seen = {};
    messages.forEach(m => {
      const userId = m.fromId === "admin" ? m.toId : m.fromId;
      if (userId === "admin") return;
      if (!seen[userId]) seen[userId] = { userId, lastTs: 0, unread: 0 };
      if (m.timestamp > seen[userId].lastTs) seen[userId].lastTs = m.timestamp;
      if (m.fromId !== "admin" && !m.read) seen[userId].unread++;
    });
    return Object.values(seen).sort((a,b) => b.lastTs - a.lastTs);
  }, [messages]);

  // Thread for selected user
  const thread = useMemo(() =>
    messages
      .filter(m => (m.fromId === selectedId && m.toId === "admin") || (m.fromId === "admin" && m.toId === selectedId))
      .sort((a,b) => a.timestamp - b.timestamp),
    [messages, selectedId]
  );

  // Mark as read when selecting
  async function selectUser(uid) {
    setSelectedId(uid);
    setReplyText("");
    if (typeof onMarkThreadRead === "function") {
      await onMarkThreadRead(uid, "admin");
    }
  }

  async function sendReply() {
    const t = replyText.trim();
    if (!t || !selectedId) return;
    const targetRole = getAccount(selectedId).role;
    const saved = await onSendReply?.(selectedId, targetRole, t);
    if (saved) {
      setReplyText("");
      setAiLoading(false);
    }
  }

  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [thread.length]);

  function getAccount(uid) {
    return runtimeAccounts?.find(a => a.id === uid) || { name: uid, role: "supplier", title: "" };
  }

  async function suggestReplyWithAI() {
    const lastMsg = thread[thread.length - 1];
    if (!lastMsg || lastMsg.fromId === "admin") return;
    const participant = getAccount(selectedId);
    const threadPayload = thread.map(m => ({
      author: m.fromId === "admin" ? "admin" : "user",
      text: m.text,
      timestamp: m.timestamp,
    }));

    setAiLoading(true);
    try {
      const suggestion = await onSuggestReply?.({
        participant: {
          name: participant.name,
          role: participant.role,
          title: participant.title || "",
        },
        thread: threadPayload,
      });
      setReplyText(suggestion || getAiAnswer(lastMsg.text));
    } catch (e) {
      console.warn("[suggestAdminReplyAI]", e);
      setReplyText(getAiAnswer(lastMsg.text));
    } finally {
      setAiLoading(false);
    }
  }

  const ROLE_COLORS_CHAT = { supplier:"#0d9488", buyer:"#2563eb", admin:"#7c3aed" };

  return (
    <div style={{ maxWidth:960, display:"flex", gap:0, background:"white", borderRadius:12, border:"1px solid #e2e8f0", overflow:"hidden", height:"calc(100vh - 110px)", minHeight:400 }}>
      {/* Left: thread list */}
      <div style={{ width:280, borderRight:"1px solid #e2e8f0", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"14px 16px", borderBottom:"1px solid #f1f5f9", background:"#f8fafc" }}>
          <div style={{ fontWeight:700, fontSize:14, color:"#1e293b", display:"flex", alignItems:"center", gap:6 }}>
            <MessageSquare size={15} color="#0d9488"/>
            Wiadomości
          </div>
          <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{participants.length} aktywnych wątków</div>
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {participants.length === 0 && (
            <div style={{ padding:32, textAlign:"center", color:"#94a3b8", fontSize:12 }}>
              Brak wiadomości.<br/>Uczestnicy mogą pisać przez pływający dymek.
            </div>
          )}
          {participants.map(({ userId, lastTs, unread }) => {
            const acc = getAccount(userId);
            const isActive = selectedId === userId;
            const lastMsg = messages.filter(m => (m.fromId===userId&&m.toId==="admin")||(m.fromId==="admin"&&m.toId===userId)).sort((a,b)=>b.timestamp-a.timestamp)[0];
            return (
              <div key={userId} onClick={()=>void selectUser(userId)}
                style={{ padding:"12px 14px", cursor:"pointer", background:isActive?"#f0fdfa":"transparent", borderBottom:"1px solid #f1f5f9", borderLeft:isActive?"3px solid #0d9488":"3px solid transparent", transition:"background 0.1s" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:32, height:32, borderRadius:"50%", background:ROLE_COLORS_CHAT[acc.role]+"22", border:`1px solid ${ROLE_COLORS_CHAT[acc.role]}44`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:12, fontWeight:700, color:ROLE_COLORS_CHAT[acc.role] }}>
                    {acc.name?.[0]?.toUpperCase()||"?"}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ fontWeight:unread>0?700:500, fontSize:12, color:"#1e293b", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acc.name}</div>
                      {unread > 0 && <span style={{ background:"#dc2626", color:"white", borderRadius:"50%", fontSize:9, fontWeight:700, width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{unread}</span>}
                    </div>
                    <div style={{ fontSize:10, color:"#94a3b8", display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ background:ROLE_COLORS_CHAT[acc.role]+"15", color:ROLE_COLORS_CHAT[acc.role], padding:"1px 5px", borderRadius:6, fontWeight:600 }}>
                        {acc.role==="supplier"?"Dostawca":acc.role==="buyer"?"Kupiec":"Admin"}
                      </span>
                      {lastMsg && <span>{new Date(lastMsg.timestamp).toLocaleDateString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>}
                    </div>
                    {lastMsg && (
                      <div style={{ fontSize:11, color:"#64748b", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:2 }}>
                        {lastMsg.fromId==="admin"?"Ty: ":""}{lastMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: conversation */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        {!selectedId ? (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#94a3b8", flexDirection:"column", gap:12 }}>
            <MessageSquare size={36} style={{ opacity:0.3 }}/>
            <div style={{ fontSize:13 }}>Wybierz wątek z listy, aby zobaczyć rozmowę</div>
          </div>
        ) : (
          <>
            {/* Header */}
            {(()=>{ const acc=getAccount(selectedId); return (
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #e2e8f0", background:"#f8fafc", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:ROLE_COLORS_CHAT[acc.role]+"22", border:`1px solid ${ROLE_COLORS_CHAT[acc.role]}44`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, color:ROLE_COLORS_CHAT[acc.role] }}>{acc.name?.[0]?.toUpperCase()||"?"}</div>
                <div>
                  <div style={{ fontWeight:700, fontSize:13, color:"#1e293b" }}>{acc.name}</div>
                  <div style={{ fontSize:11, color:"#94a3b8" }}>{acc.title || acc.role}</div>
                </div>
              </div>
            );})()}
            {/* Messages */}
            <div style={{ flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10, background:"#f8fafc" }}>
              {thread.length === 0 && (
                <div style={{ textAlign:"center", color:"#94a3b8", fontSize:12 }}>Brak wiadomości w tym wątku.</div>
              )}
              {thread.map(m => {
                const isAdmin = m.fromId === "admin";
                return (
                  <div key={m.id} style={{ display:"flex", justifyContent:isAdmin?"flex-end":"flex-start" }}>
                    <div style={{ maxWidth:"70%", padding:"9px 13px", borderRadius:isAdmin?"12px 12px 2px 12px":"12px 12px 12px 2px", background:isAdmin?"#0d9488":"white", color:isAdmin?"white":"#1e293b", fontSize:13, lineHeight:1.5, boxShadow:"0 1px 3px rgba(0,0,0,0.07)", border:isAdmin?"none":"1px solid #e2e8f0" }}>
                      {m.text}
                      <div style={{ fontSize:10, opacity:0.6, marginTop:2, textAlign:"right" }}>
                        {new Date(m.timestamp).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}
                        {isAdmin && <span style={{ marginLeft:4 }}>{m.read?"✓✓":"✓"}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef}/>
            </div>
            {/* AI suggestion bar — show when last message is from user */}
            {(()=>{
              const lastMsg = thread[thread.length - 1];
              const canSuggest = lastMsg && lastMsg.fromId !== "admin";
              if (!canSuggest) return null;
              return (
                <div style={{ padding:"8px 14px", borderTop:"1px solid #f1f5f9", background:"#fafafa", display:"flex", alignItems:"center", gap:8 }}>
                  {aiLoading ? (
                    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#7c3aed", padding:"4px 10px", background:"#f5f3ff", borderRadius:8, border:"1px solid #ddd6fe" }}>
                      <span style={{ animation:"spin 1s linear infinite", display:"inline-block", fontSize:14 }}>⚙️</span>
                      AI analizuje zapytanie...
                    </div>
                  ) : (
                    <button
                      onClick={()=>void suggestReplyWithAI()}
                      style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px", borderRadius:8, border:"1px solid #ddd6fe", background:"#f5f3ff", color:"#7c3aed", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                      ✨ Sformułuj odpowiedź (AI)
                    </button>
                  )}
                  <span style={{ fontSize:11, color:"#94a3b8" }}>Szkic zostanie wklejony do pola odpowiedzi — przejrzyj przed wysłaniem.</span>
                </div>
              );
            })()}
            {/* Reply input */}
            <div style={{ padding:"12px 14px", borderTop:"1px solid #e2e8f0", background:"white", display:"flex", gap:8 }}>
              <textarea
                value={replyText} onChange={e=>setReplyText(e.target.value)} onKeyDown={onKey}
                placeholder={`Odpowiedz do ${getAccount(selectedId).name}... (Enter = wyślij)`}
                rows={2}
                style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, fontFamily:"inherit", resize:"none", outline:"none", background:replyText?"#fffbeb":"white", transition:"background 0.2s" }}
              />
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <button onClick={()=>void sendReply()} disabled={!replyText.trim()} style={{ padding:"8px 14px", borderRadius:8, background:replyText.trim()?"#0d9488":"#e2e8f0", color:replyText.trim()?"white":"#94a3b8", border:"none", cursor:replyText.trim()?"pointer":"default", display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600 }}>
                  <SendIcon size={14}/> Wyślij
                </button>
                {replyText && (
                  <button onClick={()=>setReplyText("")} style={{ padding:"4px 8px", borderRadius:7, background:"none", border:"1px solid #e2e8f0", color:"#94a3b8", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                    Wyczyść
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


export default function App({ initialRole = "supplier", currentUser = null } = {}) {
  // lockedRole: jeśli ustawiony, ukrywamy switcher i blokujemy przełączanie
  // (admin może swobodnie udawać innych userów; dostawca/kupiec - nie)
  const lockedRole = initialRole !== "admin" ? initialRole : null;

  // Active account — driven by `currentUser` profile (Supabase profiles row).
  // [B2B Round 2] Mapowanie:
  //   - profile.company_id  -> account.id (uuid lub seedowane "sup-sX")
  //   - profile.retailer_id -> account.retailerId (legacy integer 100,200,...)
  //   - companies.legacy_fm_id -> account.fmId (przekazane z props w currentUser.legacy_fm_id)
  // Jesli currentUser nie zawiera tych pol — fallback na legacy seed (kompatybilnosc
  // wstecz dla istniejacych testowych instalacji bez migracji 008).
  const [account, setAccount] = useState(() => {
    if (initialRole === "admin") {
      return {
        id: currentUser?.id || "admin",
        role: "admin",
        name: currentUser?.name || currentUser?.email || "FM Administrator",
        title: "FM Administrator",
        email: currentUser?.email || "",
        fmId: null, chainId: null, retailerId: null
      };
    }
    if (initialRole === "buyer") {
      const rid = currentUser?.retailer_id ?? null;
      const fmChainId = rid ? (RETAILER_TO_CHAIN[Number(rid)] || null) : null;
      return {
        id: currentUser?.id || (rid ? `b-${rid}` : "b-unknown"),
        role: "buyer",
        name: currentUser?.name || currentUser?.email || "Kupiec",
        title: currentUser?.retailer_name || (rid ? `Sieć #${rid}` : "Bez przypisanej sieci"),
        email: currentUser?.email || "",
        fmId: null,
        chainId: fmChainId || rid,
        retailerId: rid,
        pkg: null
      };
    }
    // supplier (default)
    const cid = currentUser?.company_id ?? null;
    const fmId = currentUser?.legacy_fm_id || null;
    // [B2B Round 5] legacySupplierId is the value RLS expects in
    // legacy_offers/sends.supplier_legacy_id (e.g. "sup-s1"). Falls back to
    // a derived "sup-<fmId>" so existing seed-style data still works for
    // accounts that haven't had legacy_supplier_id backfilled yet.
    const legacySupplierId = currentUser?.legacy_supplier_id
      || (fmId ? `sup-${fmId}` : null);
    return {
      id: cid || legacySupplierId || "sup-unknown",
      role: "supplier",
      name: currentUser?.company_name || currentUser?.name || "Dostawca",
      title: currentUser?.country ? `Dostawca · ${currentUser.country}` : "Dostawca",
      email: currentUser?.email || "",
      fmId,
      legacySupplierId,
      chainId: null,
      retailerId: null,
      pkg: currentUser?.pkg_plan || null
    };
  });
  const mySupplierKey = account.role === "supplier" ? (account.legacySupplierId || account.id) : account.id;
  const role = account.role;
  // [B2B Round buyer-copy.1] Initial page must depend on role. Hardcoded
  // "dashboard" used to render the SUPPLIER PageDashboard for every freshly
  // logged-in buyer at /kupiec — they saw "Nowa wysyłka", "Moje propozycje
  // 4 opublikowanych" and other supplier-only UI before they could navigate
  // anywhere. Buyer lands on b-dash (PageBuyerDashboard with buyer copy);
  // admin lands on a-dash; supplier keeps "dashboard".
  const [pg,     setPg]     = useState(
    role === "buyer"  ? "b-dash" :
    role === "admin"  ? "a-dash" :
    "dashboard"
  );
  const [sid,    setSid]    = useState(null);
  const [flash,  setFlash]  = useState(null);
  // co is derived from active account when supplier
  // OFFERS — ładowane z Supabase (legacy_offers table). Seed jeśli puste.
  const [offers, _setOffersRaw] = useState(OFFERS_INIT);
  const [offersLoaded, setOffersLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    loadLegacyOffers().then(async (rows) => {
      if (canceled) return;
      if (rows && rows.length > 0) {
        _setOffersRaw(rows);
      } else if (!import.meta.env.PROD) {
        // [B2B Round 5.6] Seed bootstrap is dev/local only. In production we
        // don't auto-insert OFFERS_INIT into Supabase — empty table stays empty.
        // Reason: cleanup of ghost data (DELETE FROM legacy_offers) would
        // otherwise be undone the next time any user loaded the app, because
        // OFFERS_INIT contains demo offers tied to non-existent suppliers
        // (sup-s14 etc.). Admin can still recreate demo via resetToSeed button.
        let bridge = null;
        try { bridge = JSON.parse(localStorage.getItem("fm_offers") || "null"); } catch(e){}
        const seed = (bridge && bridge.length) ? bridge : OFFERS_INIT;
        await bulkUpsertLegacyOffers(seed);
        _setOffersRaw(seed);
        try { localStorage.removeItem("fm_offers"); } catch(e){}
      } else {
        // Production with empty table: just keep React state empty. UI shows
        // "Brak propozycji" and supplier creates fresh ones via "Dodaj propozycję".
        _setOffersRaw([]);
      }
      setOffersLoaded(true);
    });
    return () => { canceled = true; };
  }, []);
  // setOffers wraper - zapisuje do Supabase + lokalnie.
  // [B2B Round 5] Hot-path callers (saveOffer) await per-action upsert and
  // surface errors. This wrapper is defense-in-depth for state-driven multi-row
  // syncs; it deliberately swallows async errors but logs them so unhandled
  // rejections don't crash. If you need write confirmation, await db helpers.
  const setOffers = useCallback((val) => {
    _setOffersRaw((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        const prevById = new Map(prev.map((o) => [o.id, o]));
        const nextById = new Map(next.map((o) => [o.id, o]));
        const toUpsert = next.filter((o) => {
          const old = prevById.get(o.id);
          return !old || JSON.stringify(old) !== JSON.stringify(o);
        });
        const toDelete = prev.filter((o) => !nextById.has(o.id)).map((o) => o.id);
        if (toUpsert.length) bulkUpsertLegacyOffers(toUpsert).catch(e => console.warn("[setOffers async upsert]", e?.message || e));
        toDelete.forEach((id) => deleteLegacyOffer(id).catch(e => console.warn("[setOffers async delete]", e?.message || e)));
      } catch (e) { console.warn("[setOffers sync]", e); }
      return next;
    });
  }, []);

  // SENDS — analogicznie
  const [sends, _setSendsRaw] = useState(SENDS_INIT);
  const [sendsLoaded, setSendsLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    (async () => {
      // [B2B Round 5] Run idempotent 14-day expiry sweep BEFORE loading sends
      // so the hydrated state already reflects any newly-expired rows. RPC
      // failure is non-fatal — we still load whatever is in the DB.
      try {
        await dbExpireLegacySends14d();
        await dbRefundUnreadExpiredLegacySends();
      } catch (e) { console.warn("[expire sends]", e?.message || e); }
      if (canceled) return;
      try {
        const rows = await loadLegacySends();
        if (canceled) return;
        if (rows && rows.length > 0) {
          _setSendsRaw(rows);
        } else if (!import.meta.env.PROD) {
          // [B2B Round 5.6] Same reasoning as legacy_offers above. SENDS_INIT
          // contains 14 demo sends across suppliers sup-s1 / sup-s5 / sup-s14;
          // sup-s14 has no matching company row so it would re-create ghost
          // data after each cleanup. Dev only.
          let bridge = null;
          try { bridge = JSON.parse(localStorage.getItem("fm_sends") || "null"); } catch(e){}
          const seed = (bridge && bridge.length) ? bridge : SENDS_INIT;
          try { await bulkUpsertLegacySends(seed); } catch (e) { console.warn("[seed sends]", e?.message || e); }
          _setSendsRaw(seed);
          try { localStorage.removeItem("fm_sends"); } catch(e){}
        } else {
          _setSendsRaw([]);
        }
      } catch (e) { console.warn("[load sends]", e?.message || e); }
      finally { if (!canceled) setSendsLoaded(true); }
    })();
    return () => { canceled = true; };
  }, []);
  // [B2B Round 5] See setOffers note. Hot-path callers (sendToChain,
  // moderate, sendApproved, confirmManual, undoConfirm) await per-action
  // upsertLegacySend and surface errors via fl(). This wrapper is fallback.
  const setSends = useCallback((val) => {
    _setSendsRaw((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        const prevById = new Map(prev.map((s) => [s.id, s]));
        const nextById = new Map(next.map((s) => [s.id, s]));
        const toUpsert = next.filter((s) => {
          const old = prevById.get(s.id);
          return !old || JSON.stringify(old) !== JSON.stringify(s);
        });
        const toDelete = prev.filter((s) => !nextById.has(s.id)).map((s) => s.id);
        if (toUpsert.length) bulkUpsertLegacySends(toUpsert).catch(e => console.warn("[setSends async upsert]", e?.message || e));
        toDelete.forEach((id) => deleteLegacySend(id).catch(e => console.warn("[setSends async delete]", e?.message || e)));
      } catch (e) { console.warn("[setSends sync]", e); }
      return next;
    });
  }, []);
  // [B2B Round 2.1] companies: load from Supabase on mount; seed if empty.
  const [companies, _setCompaniesRaw] = useState(COMPANIES_DB);
  const [companiesLoaded, setCompaniesLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const rows = await dbGetCompanies();
        if (canceled) return;
        if (rows && rows.length > 0) {
          // Map DB rows back to legacy shape — map legacy_fm_id -> fmId
          const mapped = rows.map(r => ({
            ...r,
            fmId: r.legacy_fm_id || r.fmId || null,
            pkg: r.pkg_plan || r.pkg || null,
            pkgExpiry: r.pkg_expiry || r.pkgExpiry || null,
            logo: r.logo_url || r.logo || null,
          }));
          _setCompaniesRaw(mapped);
        } else if (!import.meta.env.PROD) {
          // [B2B Round ghost-data-cleanup] Seed bootstrap dev/local only.
          // COMPANIES_DB contains sup-s1/sup-s14 ghost-suppliers. Production
          // should never auto-seed these — if companies table is somehow empty
          // (shouldn't happen post-Round-5.6), state stays [] and UI shows
          // empty state. Admin sets up real companies via /register.
          await bulkUpsertCompanies(COMPANIES_DB);
          _setCompaniesRaw(COMPANIES_DB);
        } else {
          _setCompaniesRaw([]);
        }
        try { localStorage.removeItem("fm_companies"); } catch(e){}
      } catch (e) { console.warn("[load companies]", e); }
      finally { setCompaniesLoaded(true); }
    })();
    return () => { canceled = true; };
  }, []);
  // [B2B Round 2.2] Upewnij sie ze firma zalogowanego suppliera jest w state.
  // Bez tego PageCompany / FM supplier widget moze fallbackowac do COMPANY_INIT.
  useEffect(() => {
    if (!companiesLoaded) return;
    if (!currentUser?.company_id) return;
    _setCompaniesRaw((prev) => {
      const exists = prev.find(c => c.id === currentUser.company_id);
      if (exists) return prev;
      // Wstrzykujemy minimalny rekord firmy z profilu (do uzupelnienia przez admina/dostawce w UI)
      const injected = {
        ...COMPANY_INIT,
        id: currentUser.company_id,
        name: currentUser.company_name || currentUser.name || "Moja firma",
        country: currentUser.company_country || currentUser.country || "PL",
        fmId: currentUser.legacy_fm_id || null,
        pkg: currentUser.pkg_plan || null,
      };
      return [...prev, injected];
    });
  }, [companiesLoaded, currentUser?.company_id, currentUser?.legacy_fm_id]);
  // Debounced bulk-upsert when companies changes (saves bandwidth on rapid edits)
  const setCompanies = useCallback((val) => {
    _setCompaniesRaw((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        if (companiesLoaded) {
          // Only upsert changed rows
          const prevById = new Map(prev.map(c => [c.id, c]));
          const changed = next.filter(c => {
            const old = prevById.get(c.id);
            return !old || JSON.stringify(old) !== JSON.stringify(c);
          });
          if (changed.length) bulkUpsertCompanies(changed);
        }
      } catch(e) { console.warn("[setCompanies sync]", e); }
      return next;
    });
  }, [companiesLoaded]);
  // co = firma aktywnego dostawcy z companies (SSOT)
  const co = account.role==="supplier"
    ? (companies.find(c=>c.id===account.id) ||
       companies.find(c=>c.fmId===account.fmId) ||
       (account.fmId ? { ...COMPANY_INIT, id:account.id, name:account.name, country:account.title?.split(" · ")[1]||"PL" } : COMPANY_INIT))
    : COMPANY_INIT;
  const setCo = (val) => setCompanies(prev => {
    const updated = typeof val==="function" ? val(co) : val;
    const exists = prev.find(c=>c.id===account.id);
    if(exists) return prev.map(c=>c.id===account.id ? {...c,...updated} : c);
    return [...prev, {...updated, id:account.id}];
  });

  
  const setBuyer = (val) => {
    const updated = typeof val === "function" ? val(buyer) : val;
    if(updated.starred !== undefined) {
      setBuyerUiState(prev => ({
        ...prev,
        [account.id]: { ...(prev[account.id]||{}), starred: updated.starred }
      }));
    }
    if(account.role === "buyer" && account.retailerId) {
      setRetailers(prev => prev.map(r => {
        if(r.id !== account.retailerId) return r;
        const buyers = (r.buyers||[]).map(b => {
          if(b.id !== account.id) return b;
          return {
            ...b,
            name: updated.name ?? b.name,
            phone: updated.phone ?? b.phone,
            position: updated.position ?? b.position,
          };
        });
        return { ...r, buyers };
      }));
      dbUpdateOwnBuyerProfile(account.id, {
        name: updated.name ?? buyer.name,
        phone: updated.phone ?? buyer.phone,
        position: updated.position ?? buyer.position,
      }).catch((e) => console.warn("[buyer profile save]", e));
    }
  };
  const [limits, setLimits] = useState(LIMITS_INIT);
  // [B2B Round prod-rollout / faza 2] dbCapacity = pełna lista firm z view
  // company_capacity (companies + sum z packages). Zastępuje LIMITS_INIT mock
  // w admin panelu firm. refreshCapacity() wołane po każdej zmianie statusu /
  // zakupie pakietu, żeby UI nie był rozsynchronizowany z bazą.
  const [dbCapacity, setDbCapacity] = useState([]);
  const refreshCapacity = useCallback(async () => {
    try {
      const rows = await dbGetAllCompanyCapacity();
      setDbCapacity(rows);
    } catch (e) { console.warn("[refresh company_capacity]", e); }
  }, []);
  useEffect(() => { if (companiesLoaded) refreshCapacity(); }, [companiesLoaded, refreshCapacity]);
  const [walletMap, setWalletMap] = useState({
    "sup-s1":  { balance:160, transactions:[{id:1,desc:"Zakup pakietu Premium 10",amount:-600,date:"2026-01-15",type:"debit"},{id:2,desc:"Doładowanie",amount:760,date:"2026-01-15",type:"credit"}] },
    "sup-s5":  { balance:120, transactions:[{id:1,desc:"Zakup pakietu Standard 10",amount:-400,date:"2026-02-01",type:"debit"},{id:2,desc:"Doładowanie",amount:520,date:"2026-02-01",type:"credit"}] },
    "sup-s14": { balance:200, transactions:[{id:1,desc:"Zakup pakietu Premium 10",amount:-600,date:"2026-01-20",type:"debit"},{id:2,desc:"Doładowanie",amount:800,date:"2026-01-20",type:"credit"}] },
  });
  const walletKey = account.role === "supplier" ? mySupplierKey : account.id;
  const baseWallet = walletMap[walletKey] || walletMap[account.id] || WALLET_INIT;
  const refundedSendsForWallet = useMemo(
    () => (sends || []).filter(s =>
      s?.supplierId === mySupplierKey &&
      ["unread_expired", "refunded"].includes(s?.status) &&
      hasRefundMarker(s)
    ),
    [sends, mySupplierKey]
  );
  const wallet = useMemo(() => {
    const refundTxs = refundedSendsForWallet.map((s) => ({
      id: `refund-${s.id}`,
      desc: `Zwrot za brak odczytu propozycji #${s.id}`,
      amount: getRefundAmount(s),
      date: s.refundAt || s.data?.refundAt || s.expiredAt || s.sentAt || s.sendDate || nowStr().slice(0, 10),
      type: "refund",
    }));
    const existingIds = new Set((baseWallet.transactions || []).map((t) => String(t.id)));
    const missingRefundTxs = refundTxs.filter((t) => !existingIds.has(String(t.id)));
    const refundTotal = missingRefundTxs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return {
      balance: Number(baseWallet.balance || 0) + refundTotal,
      transactions: [...(baseWallet.transactions || []), ...missingRefundTxs],
    };
  }, [baseWallet, refundedSendsForWallet]);
  const setWallet = (val) => setWalletMap(prev=>({ ...prev, [walletKey]: typeof val==="function"?val(wallet):val }));
  const [orders, setOrders] = useState([
    { id:1, planId:"std_10", planLabel:"Standard 10 wysyłek", price:400, perSend:40, qty:10, date:"2026-01-15", status:"paid", paymentMethod:"przelew", firmName:"Food Market" },
  ]);
  // [B2B Round 2.1] retailers: load from Supabase on mount; seed if empty.
  const [retailers, _setRetailersRaw] = useState(() =>
    RETAILERS.map(r => ({
      ...r,
      active: true,
      fm26ChainId: RETAILER_TO_CHAIN[r.id] || null,
      fm26Active: !!RETAILER_TO_CHAIN[r.id],
      buyers: [{
        id: r.id + "_b1",
        name: r.buyer || "",
        email: r.email || "",
        phone: r.phone || "",
        cats: r.cats || [],
        active: true,
        fm26Active: !!RETAILER_TO_CHAIN[r.id]
      }]
    }))
  );
  const [retailersLoaded, setRetailersLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const rows = await dbGetRetailers();
        if (canceled) return;
        if (rows && rows.length > 0) {
          // Retailers are the shared source of truth; buyer accounts come from
          // real profiles rows linked by profiles.retailer_id.
          const mapped = rows.map(r => {
            const profileBuyers = (r.buyers || [])
              .filter(b => !b.role || b.role === "buyer")
              .map(b => ({
                id: b.id,
                name: b.name || "",
                email: b.email || "",
                phone: b.phone || "",
                position: b.position || "",
                cats: b.buyer_categories || r.cats || [],
                active: b.active !== false,
                fm26Active: !!(b.fm26_active ?? r.fm26_active),
                isManaged: true,
              }));
            const fallbackBuyers = profileBuyers.length ? profileBuyers : [{
              id: r.id + "_b1",
              name: r.buyer_name || "",
              email: r.buyer_email || "",
              phone: r.buyer_phone || "",
              position: "",
              cats: r.cats || [],
              active: true,
              fm26Active: !!(r.fm26_active ?? RETAILER_TO_CHAIN[r.id]),
              isManaged: false,
            }];
            return {
              ...r,
              fm26ChainId: r.fm26_chain_id || r.fm26ChainId || RETAILER_TO_CHAIN[r.id] || null,
              fm26Active:  !!(r.fm26_active ?? r.fm26Active ?? RETAILER_TO_CHAIN[r.id]),
              active: r.active !== false,
              buyers: fallbackBuyers,
            };
          });
          _setRetailersRaw(mapped);
        } else if (!import.meta.env.PROD) {
          // [B2B Round ghost-data-cleanup] Same gating as companies.
          // Production retailers are admin-managed; auto-seed should not run.
          const seed = RETAILERS.map(r => ({
            ...r, active: true, fm26ChainId: RETAILER_TO_CHAIN[r.id] || null,
            fm26Active: !!RETAILER_TO_CHAIN[r.id],
            buyers: [{ id: r.id + "_b1", name: r.buyer || "", email: r.email || "", phone: r.phone || "", cats: r.cats || [], active: true, fm26Active: !!RETAILER_TO_CHAIN[r.id] }]
          }));
          await bulkUpsertRetailers(seed);
          _setRetailersRaw(seed);
        } else {
          _setRetailersRaw([]);
        }
        try { localStorage.removeItem("fm_retailers"); } catch(e){}
      } catch (e) { console.warn("[load retailers]", e); }
      finally { setRetailersLoaded(true); }
    })();
    return () => { canceled = true; };
  }, []);
  const setRetailers = useCallback((val) => {
    _setRetailersRaw((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        if (retailersLoaded) {
          const prevById = new Map(prev.map(r => [r.id, r]));
          const changed = next.filter(r => {
            const old = prevById.get(r.id);
            return !old || JSON.stringify(old) !== JSON.stringify(r);
          });
          if (changed.length) bulkUpsertRetailers(changed);
        }
      } catch(e) { console.warn("[setRetailers sync]", e); }
      return next;
    });
  }, [retailersLoaded]);
  // buyerUiState: only starred (UI state per buyer) — MUST be after retailers
  const [buyerUiState, setBuyerUiState] = useState({});
  const buyer = (() => {
    const starred = buyerUiState[account.id]?.starred || [];
    if(account.role === "buyer" && account.retailerId) {
      const r = (retailers||[]).find(x => x.id === account.retailerId);
      const b = (r?.buyers||[]).find(x => x.id === account.id) || null;
      if(currentUser?.role === "buyer") return {
        name: currentUser.name || b?.name || "",
        position: currentUser.position || b?.position || "Category Manager",
        company: r?.name || currentUser?.retailer_name || "",
        email: currentUser.email || b?.email || "",
        phone: currentUser.phone || b?.phone || "",
        country: r?.country || "PL",
        consent: true,
        starred,
        active: currentUser.active !== false && (b?.active !== false),
        cats: currentUser.buyer_categories || b?.cats || r?.cats || [],
      };
      if(b) return {
        name: b.name || "", position: b.position || "Category Manager",
        company: r?.name || "", email: b.email || "",
        phone: b.phone || "", country: r?.country || "PL",
        consent: true, starred, active: b.active !== false, cats: b.cats || r?.cats || [],
      };
    }
    return { ...BUYER_INIT, starred };
  })();
  const REFUND_NOTIFS_SEED = [
    { id:10, supplierId:"sup-s5", msg:"Brokuły → Carrefour nie zostały przeczytane w 14 dni. Zwrot 40 EUR wrócił na Twoje konto.", amount:40, dismissed:false }
  ];
  const [refundNotifs, setRefundNotifs] = useState(() => {
    try { const s=localStorage.getItem("fm_refundNotifs"); return s?JSON.parse(s):REFUND_NOTIFS_SEED; } catch(e){ return REFUND_NOTIFS_SEED; }
  });
  const [fmWishlists, setFmWishlists] = useState({});
  // fmLateResps: late selections for a chain unlocked by admin after Sept 16
  // structure: { [chainId]: { [supplierId]: "want"|"chance"|"remove" } }
  // These do NOT feed the algorithm — admin-only reference for manual corrections
  const [fmLateResps, setFmLateResps] = useState({});
  // previewFor: set of supplier/chain IDs for which admin has enabled preview
  // structure: { suppliers: Set→Array, chains: Set→Array }
  const [previewFor, setPreviewFor] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("fm_previewFor"));
      return s || { suppliers: [], chains: [] };
    } catch(e){ return { suppliers: [], chains: [] }; }
  });
  const [messages, setMessages] = useState([]);
  const [aiModal, setAiModal] = useState(false);
  const [aiLoad,  setAiLoad]  = useState(false);

  // FM Scheduling state
  const [fmSettings, setFmSettings] = useState({ schedulingOpen: false, openDate: "2026-09-01", currentPhase: 2, planPublished: false });
  const [fmSettingsLoaded, setFmSettingsLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const settings = await dbGetFmSettings();
        if (!canceled && settings) {
          setFmSettings((prev) => ({ ...prev, ...settings }));
        }
      } catch (e) {
        console.warn("[load fmSettings]", e);
      } finally {
        if (!canceled) setFmSettingsLoaded(true);
      }
    })();
    return () => { canceled = true; };
  }, []);
  useEffect(() => {
    if (!fmSettingsLoaded || account.role !== "admin") return;
    const t = setTimeout(() => {
      dbSaveFmSettings(fmSettings).catch(e => console.warn("[save fmSettings]", e));
    }, 500);
    return () => clearTimeout(t);
  }, [fmSettings, fmSettingsLoaded, account.role]);

  // [B2B Round 2.1] fmPrefs / fmResps: kept in fm_settings.schedule.meta + fm_resps table.
  // Initial: try Supabase; fallback to seed _fmInitData.
  // Production state starts empty and is hydrated from Supabase. Demo data can
  // still be generated manually from the admin "Dane testowe" button.
  const [fmPrefs, setFmPrefs] = useState({});
  const [fmResps, setFmResps] = useState({});
  const [fmRespsLoaded, setFmRespsLoaded] = useState(false);
  const fmRespsSavePrimedRef = useRef(false);
  useEffect(() => {
    if (!companiesLoaded || !retailersLoaded) return;
    let canceled = false;
    (async () => {
      try {
        const targets = await dbGetAllCompanyTargetRetailers();
        if (canceled) return;
        if (targets && targets.length > 0) {
          const groupedPrefs = {};
          for (const row of targets) {
            const coRow = companies.find(c => c.id === row.company_id);
            const supKey = coRow?.fmId || coRow?.legacy_fm_id || row.company_id;
            const chainKey = resolveChainIdFromRetailer(row.retailer_id, retailers, { note: row.note });
            if (!supKey || !chainKey) continue;
            if (!groupedPrefs[supKey]) groupedPrefs[supKey] = {};
            groupedPrefs[supKey][chainKey] = Number(row.priority || 0) >= 1000 ? "star" : "thumb";
          }
          if (Object.keys(groupedPrefs).length) {
            setFmPrefs(prev => ({ ...prev, ...groupedPrefs }));
          }
        }

        // fmResps from fm_resps table (admin sees all rows)
        const rows = await dbGetFmResps();
        if (canceled) return;
        if (rows && rows.length > 0) {
          // Convert flat rows to keyed structure expected by PreconnectFM
          const grouped = {};
          for (const r of rows) {
            if (!r.retailer_id) continue;
            const chainKey = resolveChainIdFromRetailer(r.retailer_id, retailers, r.meta || {});
            const supCompany = companies.find(c => c.id === r.supplier_company_id);
            const supKey = (r.meta && r.meta.supplier_legacy_id) || supCompany?.fmId || r.supplier_company_id;
            if (!chainKey || !supKey) continue;
            if (!grouped[chainKey]) grouped[chainKey] = {};
            grouped[chainKey][supKey] = r.zone || r.status || null;
          }
          if (Object.keys(grouped).length) setFmResps(grouped);
        }
        try { localStorage.removeItem("fm_fmResps"); } catch(e){}
        try { localStorage.removeItem("fm_fmPrefs"); } catch(e){}
      } catch (e) { console.warn("[load fmResps]", e); }
      finally { if (!canceled) setFmRespsLoaded(true); }
    })();
    return () => { canceled = true; };
  }, [companiesLoaded, retailersLoaded, companies, retailers]);
  useEffect(() => {
    if (!retailersLoaded) return;
    if (!["admin", "buyer"].includes(account.role)) {
      setFmWishlists({});
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const retailerId = account.role === "buyer" ? account.retailerId : null;
        let rows = await dbGetFmWishlists(retailerId);
        if (canceled) return;
        const legacy = (() => {
          try { return JSON.parse(localStorage.getItem("fm_fmWishlists")) || {}; } catch (e) { return {}; }
        })();
        const allowedChainId = account.role === "buyer"
          ? (retailers.find(r => r.id === account.retailerId)?.fm26ChainId || account.chainId || null)
          : null;
        const legacyRows = [];
        Object.entries(legacy || {}).forEach(([chainId, supplierIds]) => {
          if (allowedChainId && chainId !== allowedChainId) return;
          const mappedRetailerId = resolveRetailerIdFromChain(chainId, retailers);
          if (!mappedRetailerId) return;
          (supplierIds || []).forEach((supplierLegacyId) => {
            if (!supplierLegacyId) return;
            legacyRows.push({
              retailer_id: mappedRetailerId,
              supplier_legacy_id: supplierLegacyId,
              data: { chain_id: chainId, migrated_from_local_storage: true },
            });
          });
        });
        if (legacyRows.length) {
          const existing = new Set((rows || []).map(r => `${r.retailer_id}::${r.supplier_legacy_id}`));
          const missing = legacyRows.filter(r => !existing.has(`${r.retailer_id}::${r.supplier_legacy_id}`));
          if (missing.length) {
            await Promise.all(missing.map(row => dbSaveFmWishlist(row).catch(e => console.warn("[migrate fmWishlists]", e))));
            rows = [...(rows || []), ...missing];
          }
          try { localStorage.removeItem("fm_fmWishlists"); } catch (e) {}
        }
        if (!canceled) setFmWishlists(groupFmWishlists(rows, retailers));
      } catch (e) {
        console.warn("[load fmWishlists]", e);
        if (!canceled) setFmWishlists({});
      }
    })();
    return () => { canceled = true; };
  }, [retailersLoaded, retailers, account.role, account.retailerId, account.chainId]);
  useEffect(() => {
    if (!retailersLoaded) return;
    if (!["admin", "buyer"].includes(account.role)) {
      setFmLateResps({});
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const retailerId = account.role === "buyer" ? account.retailerId : null;
        let rows = await dbGetFmLateResps(retailerId);
        if (canceled) return;
        const legacy = (() => {
          try { return JSON.parse(localStorage.getItem("fm_fmLateResps")) || {}; } catch (e) { return {}; }
        })();
        const allowedChainId = account.role === "buyer"
          ? (retailers.find(r => r.id === account.retailerId)?.fm26ChainId || account.chainId || null)
          : null;
        const legacyRows = [];
        Object.entries(legacy || {}).forEach(([chainId, supplierMap]) => {
          if (allowedChainId && chainId !== allowedChainId) return;
          const mappedRetailerId = resolveRetailerIdFromChain(chainId, retailers);
          if (!mappedRetailerId) return;
          Object.entries(supplierMap || {}).forEach(([supplierLegacyId, zone]) => {
            if (!supplierLegacyId || !zone) return;
            legacyRows.push({
              retailer_id: mappedRetailerId,
              supplier_legacy_id: supplierLegacyId,
              zone,
              data: { chain_id: chainId, migrated_from_local_storage: true },
            });
          });
        });
        if (legacyRows.length) {
          const existing = new Set((rows || []).map(r => `${r.retailer_id}::${r.supplier_legacy_id}`));
          const missing = legacyRows.filter(r => !existing.has(`${r.retailer_id}::${r.supplier_legacy_id}`));
          if (missing.length) {
            await Promise.all(missing.map(row => dbSaveFmLateResp(row).catch(e => console.warn("[migrate fmLateResps]", e))));
            rows = [...(rows || []), ...missing];
          }
          try { localStorage.removeItem("fm_fmLateResps"); } catch (e) {}
        }
        if (!canceled) setFmLateResps(groupFmLateResps(rows, retailers));
      } catch (e) {
        console.warn("[load fmLateResps]", e);
        if (!canceled) setFmLateResps({});
      }
    })();
    return () => { canceled = true; };
  }, [retailersLoaded, retailers, account.role, account.retailerId, account.chainId]);
  useEffect(() => {
    if (!account?.id) {
      setMessages([]);
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const rows = account.role === "admin"
          ? await dbGetFmMessages({ limit: 300 })
          : await dbGetFmMessages({ threadKey: getFmThreadKey(account.id), limit: 200 });
        if (canceled) return;
        try { localStorage.removeItem("fm_messages"); } catch (e) {}
        setMessages(sortMessagesChronologically((rows || []).map(normalizeFmMessage).filter(Boolean)));
      } catch (e) {
        console.warn("[load fmMessages]", e);
        if (!canceled) setMessages([]);
      }
    })();
    return () => { canceled = true; };
  }, [account.id, account.role]);
  const fmChains = useMemo(() =>
    retailers
      .filter(r => r.fm26Active && r.active !== false && r.fm26ChainId)
      .map(r => ({
        id: r.fm26ChainId,
        name: r.name,
        country: r.country,
        cat: (r.buyers||[]).flatMap(b=>b.cats||[]).filter((v,i,a)=>a.indexOf(v)===i).join(", ") || "owoce, warzywa",
        logo_url: r.logo_url || r.logo || null,
        color: r.color || "#0d9488",
        bg: r.bg || "#f0fdfa",
        initials: r.initials || (r.name || "?").split(/\s+/).map(x=>x[0]).join("").slice(0,3).toUpperCase(),
      })),
    [retailers]
  );
  const fmSuppliers = useMemo(() =>
    companies
      .filter(co => co.fmId)
      .map((co, idx) => ({
        id:          co.fmId,
        name:        co.name,
        pkg:         co.pkg === "prem_10" ? "Premium" : "Business",
        country:     co.country,
        products:    co.products || "",
        companyId:   co.id,
        paymentDate: co.paymentDate || co.paidAt || null, // real payment date for scheduling priority
        _sortIdx:    idx, // stable fallback
      })),
    [companies]
  );

  const fmAlgo = useMemo(() => buildFMData(fmPrefs, fmResps, fmChains, fmSuppliers), [fmPrefs, fmResps, fmChains, fmSuppliers]);

  const runtimeAccounts = useMemo(() => {
    // [B2B Round admin-entry-fix] When the logged-in user is admin, build the
    // adminAcc from real auth identity so its `id` matches account.id (the
    // currentUser.id used during App's account useState init). Without this,
    // runtimeAccounts had a seed entry id="admin" that never matched the
    // auth UUID — `stillExists` returned undefined and the auto-switch effect
    // (~line 1828) flipped the admin onto the first supplier on mount.
    // For non-admin sessions we keep the seed Oksana entry so the account
    // switcher still presents an "admin" option for demo / view-as.
    const adminAcc = currentUser && initialRole === "admin"
      ? {
          id: currentUser.id || "admin",
          role: "admin",
          name: currentUser.name || currentUser.email || "FM Administrator",
          title: "FM Administrator",
          email: currentUser.email || "oksana@freshmarket.eu",
          fmId: null, chainId: null, retailerId: null,
        }
      : {
          id:"admin", role:"admin",
          name:"Oksana Kozłowska", title:"FM Administrator",
          email:"oksana@freshmarket.eu",
          fmId:null, chainId:null, retailerId:null
        };
    const supplierAccs = companies.map(co => ({
      id: co.id,
      role: "supplier",
      name: co.name,
      title: `Dostawca · ${co.country}`,
      email: co.contacts?.[0]?.email || "sales@"+co.name.toLowerCase().replace(/[^a-z0-9]/g,"")+".com",
      fmId: co.fmId || null,
      chainId: null,
      retailerId: null,
      pkg: co.pkg || "std_10",
    }));
    const buyerAccs = [];
    (retailers||[]).forEach(r => {
      if(r.active === false) return;
      (r.buyers||[]).forEach(b => {
        if(b.active === false) return;
        buyerAccs.push({
          id: b.id,
          role: "buyer",
          name: b.name || r.name,
          title: r.name,
          email: b.email || "",
          fmId: null,
          chainId: r.fm26ChainId || null,
          retailerId: r.id,
          pkg: null,
        });
      });
    });
    return [adminAcc, ...supplierAccs, ...buyerAccs];
  }, [companies, retailers, currentUser?.id, currentUser?.email, currentUser?.name, initialRole]);

  useEffect(() => {
    const stillExists = runtimeAccounts.find(a => a.id === account.id);
    if (stillExists) return;
    if (runtimeAccounts.length === 0) return;
    // [B2B Round 2.2] W lockedRole mode (supplier/buyer) NIE nadpisujemy
    // realnego usera kontem seed. Trzymamy `account` z currentUser nawet jesli
    // nie jest jeszcze w runtimeAccounts - zostanie tam wstawiony, gdy zalogowana
    // firma/sieć dojedzie do `companies`/`retailers` z DB.
    if (lockedRole) {
      // Robimy nic. Zachowujemy current account, ktorego pola id/fmId/retailerId
      // pochodza z profile.company_id / profile.retailer_id (Round 2.1 mapping).
      return;
    }
    // [B2B Round admin-entry-fix] Real-auth admin (account.role === "admin")
    // must NEVER be auto-switched to a supplier seed on mount. The legacy
    // demo behavior — "admin lands on first supplier as default" — was for
    // the showcase mode where there was no real auth. In production it
    // caused /admin to render PageDashboard (supplier) hiding PageAdminDash
    // and the FM admin tools. Real admin already has account.role="admin"
    // and pg="a-dash" from App init; nothing to do.
    if (account.role === "admin") {
      return;
    }
    // Demo / no-auth fallback: pick first supplier as default account so
    // the showcase has something to render.
    const firstSupplier = runtimeAccounts.find(a => a.role === "supplier");
    if (firstSupplier) switchAccount(firstSupplier);
  }, [runtimeAccounts]); // eslint-disable-line

  const onFMRegenerate = useCallback(() => { const d=genFMData(fmSuppliers, fmChains); setFmPrefs(d.p); setFmResps(d.r); }, [fmSuppliers, fmChains]);
  // [B2B Round 2.1] fmSchedule: load from fm_settings.schedule (Supabase).
  const [fmSchedule, setFmSchedule] = useState(null);
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const sched = await dbGetFmSchedule();
        if (canceled) return;
        if (sched) setFmSchedule(sched);
        try { localStorage.removeItem("fm_fmSchedule"); } catch(e){}
      } catch (e) { console.warn("[load fmSchedule]", e); }
    })();
    return () => { canceled = true; };
  }, []);

  // [B2B Round 2.1] Persistence:
  //   - companies / retailers: synced through setCompanies / setRetailers wrappers (above)
  //   - offers / sends:        synced through setOffers / setSends wrappers
  //   - fmSchedule:            debounced save to fm_settings.schedule
  //   - fmResps:               saved per-action by handlers (Accept/Reject); also debounced fallback below
  //   - fmWishlists/fmLateResps/messages: hydrated from Supabase
  //   - UI-only state (previewFor, refundNotifs): localStorage OK
  useEffect(() => {
    fmRespsSavePrimedRef.current = false;
  }, [account.id, account.role]);
  // Debounced save of fmSchedule:
  useEffect(() => {
    if (!fmSchedule) return;
    const t = setTimeout(() => {
      dbSaveFmSchedule(fmSchedule).catch(e => console.warn("[saveFmSchedule]", e));
    }, 800);
    return () => clearTimeout(t);
  }, [fmSchedule]);
  // Debounced fallback save of fmResps should only ever run for the currently
  // logged-in buyer. Supplier/admin views may hydrate fm_resps for display, but
  // they must not try to write buyer decisions back to the table.
  useEffect(() => {
    if (account.role !== "buyer" || !account.retailerId || !fmRespsLoaded) return;
    if (!fmRespsSavePrimedRef.current) {
      fmRespsSavePrimedRef.current = true;
      return;
    }
    const chainId = retailers.find(r => r.id === account.retailerId)?.fm26ChainId;
    if (!chainId) return;
    const t = setTimeout(() => {
      try {
        const inner = fmResps?.[chainId];
        if (!inner) return;
        for (const supKey of Object.keys(inner)) {
          const zone = inner[supKey];
          const supCompany = companies.find(c => c.fmId === supKey || c.id === supKey);
          const supplier_company_id = supCompany?.id;
          if (!supplier_company_id) continue;
          dbSaveFmResp({
            retailer_id: account.retailerId,
            supplier_company_id,
            zone,
            status: zone,
            meta: { supplier_legacy_id: supKey, chain_id: chainId }
          }).catch(e => console.warn("[saveFmResp]", e));
        }
      } catch(e) { console.warn("[debounced fmResps save]", e); }
    }, 1500);
    return () => clearTimeout(t);
  }, [fmResps, companies, retailers, account.role, account.retailerId, fmRespsLoaded]);
  useEffect(() => {
    if (account.role !== "supplier" || refundedSendsForWallet.length === 0) return;
    setRefundNotifs(prev => {
      const known = new Set((prev || []).map(n => String(n.id)));
      const additions = refundedSendsForWallet
        .filter(s => !known.has(`refund-${s.id}`))
        .map(s => ({
          id: `refund-${s.id}`,
          supplierId: mySupplierKey,
          amount: getRefundAmount(s),
          msg: `Zwrot za brak odczytu propozycji #${s.id} został zapisany na portfelu.`,
          dismissed: false,
        }));
      return additions.length ? [...additions, ...(prev || [])] : prev;
    });
  }, [account.role, refundedSendsForWallet, mySupplierKey]);
  // UI-only state stays in localStorage:
  useEffect(() => {
    try {
      localStorage.setItem("fm_refundNotifs", JSON.stringify(refundNotifs));
      localStorage.setItem("fm_previewFor",   JSON.stringify(previewFor));
    } catch(e){}
  }, [refundNotifs, previewFor]);

  // pkgMax = limit for current supplier account
  const myLimit = limits.find(l=>l.id===account.id) || {
    id: account.id, name: account.name,
    pkg: account.pkg==="Premium" ? "prem_10" : "std_10",
    max: account.pkg==="Premium" ? 10 : 5,
    used: 0, pkgExpiry: "2026-12-31", email: account.email||""
  };
  // [B2B Round 5.2] mySupplierKey is what `offers.supplierId` and `sends.supplierId`
  // contain for THIS supplier — Round 5 changed saveOffer/sendToChain to use
  // legacySupplierId (sup-codex-silvicola) so RLS supplier_legacy_id check passes.
  // But UI filters historically used account.id (company UUID). Without this
  // alias, freshly saved offers/sends are invisible to their own creator.
  // For non-supplier roles legacySupplierId is null → falls back to account.id.
  const pkgUsed = sends.filter(s=>s.supplierId===mySupplierKey&&!["rejected","refunded","queued"].includes(s.status)).length;
  const pkgMax  = myLimit.max;
  const rem     = Math.max(0, pkgMax - pkgUsed);

  const fl  = (m,t) => { setFlash({m, t:t||"success"}); setTimeout(()=>setFlash(null), 3800); };
  const nav = (p,id) => { setPg(p); setSid(id||null); setFlash(null); };

  function resetToSeed() {
    // [B2B Round ghost-data-cleanup] Hard-block resetToSeed in production.
    // The function was useful for staging/QA but in production it would
    // re-inject SENDS_INIT/OFFERS_INIT/COMPANIES_DB which contain
    // sup-s1/sup-s14 ghost suppliers — undoing any cleanup. Admin who
    // really needs to reset prod must do it consciously via Supabase SQL.
    if (import.meta.env.PROD) {
      fl("Reset danych testowych jest wyłączony w produkcji. Skontaktuj się z deweloperem aby wykonać reset bezpośrednio w bazie.", "error");
      return;
    }
    ["fm_offers","fm_sends","fm_fmPrefs","fm_fmResps","fm_fmSchedule","fm_retailers","fm_companies","fm_refundNotifs","fm_fmWishlists","fm_fmLateResps","fm_previewFor","fm_messages"].forEach(k=>localStorage.removeItem(k));
    setOffers(OFFERS_INIT);
    setSends(SENDS_INIT);
    setFmPrefs(_fmInitData.p);
    setFmResps(_fmInitData.r);
    setFmSchedule(null);
    setRetailers(RETAILERS.map(r=>({...r, active:true, fm26ChainId:RETAILER_TO_CHAIN[r.id]||null, fm26Active:!!RETAILER_TO_CHAIN[r.id], buyers:[{
      id:r.id+"_b1", name:r.buyer||"", email:r.email||"", phone:r.phone||"", cats:r.cats||[], active:true, fm26Active:!!RETAILER_TO_CHAIN[r.id]
    }]})));
    setCompanies(COMPANIES_DB);
    setRefundNotifs(REFUND_NOTIFS_SEED);
    setPreviewFor({ suppliers: [], chains: [] });
    fl("Dane testowe zresetowane do domyślnych.");
  }

  // ── Buy Package (simulated payment flow) ───────────────────────────────
  function buyPackage(planId, paymentMethod) {
    const plan = getPlanById(planId);
    if (!plan) return;
    const now = new Date().toISOString().slice(0,10);
    const newOrderId = Date.now();
    // 1. Add order record
    setOrders(prev => [...prev, {
      id: newOrderId,
      planId: plan.id,
      planLabel: `${plan.tier==="PREMIUM"?"Premium":"Standard"} ${plan.qty} ${plan.qty===1?"wysyłka":"wysyłek"}`,
      price: plan.price,
      perSend: plan.perSend,
      qty: plan.qty,
      date: now,
      status: "paid",
      paymentMethod,
      firmName: "Food Market",
    }]);
    // 2. Deduct from wallet (or add balance if needed)
    setWallet(prev => ({
      ...prev,
      balance: Math.max(0, prev.balance - plan.price),
      transactions: [...prev.transactions, {
        id: newOrderId,
        desc: `Zakup pakietu ${plan.tier==="PREMIUM"?"Premium":"Standard"} ${plan.qty} wysyłek`,
        amount: -plan.price,
        date: now,
        type: "debit",
      }],
    }));
    // 3. Update limits for firm 1 – add qty to current max, update pkg
    setLimits(prev => prev.map(l => l.id===account.id
      ? { ...l, pkg: planId, max: l.max + plan.qty, pkgExpiry: now.slice(0,4)+"-12-31" }
      : l
    ));
    // 4. Update company pkg reference in companies SSOT
    setCo(prev => ({ ...prev, pkg: planId }));
    fl(`Pakiet zakupiony! +${plan.qty} wysyłek dodanych do Twojego konta.`);
  }

  // ── Actions ────────────────────────────────────────────────────────────
  // [B2B Round 5] Hot-path actions: per-action awaited save with error toast.
  // Sequence: build new state -> await dbUpsert -> on success update React state +
  // success toast + nav; on failure show error toast and DO NOT update state.
  // This makes "Propozycja opublikowana!" honest — if you see it, it's in DB.
  async function saveOffer(d, st) {
    const supplierKey = account.legacySupplierId || account.id;
    const isUpdate = d.id && offers.find(o => o.id === d.id);
    const newOffer = isUpdate
      ? { ...offers.find(o => o.id === d.id), ...d, status: st }
      : { ...d, id: genUniqueLegacyId(offers), supplierId: supplierKey, status: st };
    try {
      await upsertLegacyOffer(newOffer);
    } catch (e) {
      fl(`Błąd zapisu propozycji: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    _setOffersRaw(prev => isUpdate
      ? prev.map(o => o.id === d.id ? newOffer : o)
      : [...prev, newOffer]
    );
    fl(st === "active" ? "Propozycja opublikowana!" : "Szkic zapisany.");
    nav("offers");
  }

  async function sendToChain(oId, rId) {
    // [B2B Round supplier-onboarding-access-and-communication]
    // Trzy bramki dostępu, każda z innym komunikatem dla supplera:
    //   1. Konto musi być zatwierdzone (account_status='active')
    //   2. PreConnect musi być włączony (preconnect_enabled=true)
    //   3. Pakiet musi mieć kredyty (rem > 0)
    if (account.role === "supplier" && co?.id) {
      const status = co.account_status || "active";
      if (status === "pending_review") {
        fl("Konto czeka na zatwierdzenie przez administratora. Po aktywacji odblokujemy wysyłkę ofert.", "warning");
        return;
      }
      if (status === "rejected" || status === "suspended") {
        fl("Konto jest aktualnie nieaktywne. Skontaktuj się z newsletter@freshmarket.eu.", "error");
        return;
      }
      if (!co.preconnect_enabled) {
        fl("PreConnect nie jest jeszcze aktywny dla Twojej firmy. Administrator włącza moduł indywidualnie.", "warning");
        return;
      }
    }
    if (rem <= 0) {
      fl(`Brak dostępnych kredytów w pakiecie (${pkgUsed}/${pkgMax} wykorzystanych). Doładuj pakiet w "Finanse".`, "error");
      return;
    }
    const supplierKey = account.legacySupplierId || account.id;
    const newSend = {
      id: genUniqueLegacyId(sends),
      supplierId: supplierKey,
      offerId: oId,
      retailerId: rId,
      month: "2026-05",
      pos: sends.filter(s => s.retailerId === rId).length + 1,
      status: "pending_moderation",
      price: getPlanById(co?.pkg)?.perSend || getPlanById(COMPANY_INIT.pkg)?.perSend || 40,
      sendDate: new Date().toISOString().slice(0, 10),
      daysLeft: 14,
      confirmHistory: [],
    };
    try {
      await upsertLegacySend(newSend);
    } catch (e) {
      fl(`Błąd wysyłki: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    _setSendsRaw(prev => [...prev, newSend]);
    // [B2B Round supplier-onboarding-access-and-communication]
    // Email D — fire-and-forget. Resolveuje retailer name dla template.
    const retailer = (retailers || []).find(r => r.id === rId);
    const offer = (offers || []).find(o => o.id === oId);
    if (co?.id) {
      void dbNotifySupplier({
        template: "offer_to_moderation",
        company_id: co.id,
        payload: {
          companyName: co.name,
          offerTitle: offer?.title || offer?.product || `Oferta #${oId}`,
          retailerName: retailer?.name || null,
        },
      });
    }
    fl("Propozycja dodana do kolejki moderacji.");
    nav("wysylki");
  }

  async function moderate(id, act) {
    const cur = sends.find(x => x.id === id);
    if (!cur) return;
    const updated = { ...cur, status: act === "approve" ? "approved" : "rejected" };
    try {
      await upsertLegacySend(updated);
    } catch (e) {
      fl(`Błąd moderacji: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    _setSendsRaw(s => s.map(x => x.id === id ? updated : x));
    // [B2B Round supplier-onboarding-access-and-communication]
    // Email E — informuj supplera, że jego oferta została zaakceptowana.
    // Tylko dla 'approve' (rejected nie wysyłamy maila — admin może komunikować
    // ręcznie albo przez chat w panelu; nie chcemy spamować rejection).
    if (act === "approve") {
      const offer = (offers || []).find(o => o.id === cur.offerId);
      const retailer = (retailers || []).find(r => r.id === cur.retailerId);
      const supplierCo = (companies || []).find(c => legacyKeyMatchesCompany(cur.supplierId, c));
      if (supplierCo?.id) {
        void dbNotifySupplier({
          template: "offer_approved",
          company_id: supplierCo.id,
          payload: {
            companyName: supplierCo.name,
            offerTitle: offer?.title || offer?.product || `Oferta #${cur.offerId}`,
            retailerName: retailer?.name || null,
          },
        });
      }
    }
    fl(act === "approve" ? "Propozycja zatwierdzona" : "Propozycja odrzucona");
  }

  // updateSendDate / updateSendPos: lightweight admin-only edits, keep silent
  // bulk path (wrapper handles persistence). Errors are non-fatal here.
  function updateSendDate(id, date) { setSends(s => s.map(x => x.id === id ? { ...x, sendDate: date } : x)); }
  function updateSendPos(id, pos)   { setSends(s => s.map(x => x.id === id ? { ...x, pos: +pos } : x)); }

  async function sendApproved() {
    const approved = sends.filter(s => s.status === "approved");
    if (!approved.length) { fl("Brak zatwierdzonych propozycji.", "warning"); return; }
    const today = new Date().toISOString().slice(0, 10);
    const updated = approved.map(s => ({ ...s, status: "sent", sentAt: s.sendDate || today, daysLeft: 14 }));
    try {
      await bulkUpsertLegacySends(updated);
    } catch (e) {
      fl(`Błąd wysyłki: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    const updatedById = new Map(updated.map(u => [u.id, u]));
    _setSendsRaw(s => s.map(x => updatedById.get(x.id) || x));
    fl(`Wysłano ${updated.length} propozycji.`);
  }

  async function confirmManual(id, rt, note) {
    const cur = sends.find(x => x.id === id);
    if (!cur) return;
    const ts = nowStr();
    const updated = {
      ...cur,
      status: "read_manual",
      readAt: ts,
      readType: rt,
      manualNote: note,
      daysLeft: 0,
      confirmHistory: [...(cur.confirmHistory || []), { action: "confirm", type: rt, note, at: ts }],
    };
    try {
      await upsertLegacySend(updated);
    } catch (e) {
      fl(`Błąd potwierdzenia: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    _setSendsRaw(s => s.map(x => x.id === id ? updated : x));
    fl("Potwierdzenie zapisane.");
  }

  async function undoConfirm(id) {
    const cur = sends.find(x => x.id === id);
    if (!cur) return;
    const ts = nowStr();
    const updated = {
      ...cur,
      status: "sent",
      readAt: null,
      readType: null,
      manualNote: null,
      daysLeft: 3,
      confirmHistory: [...(cur.confirmHistory || []), { action: "undo", note: "Cofnięcie potwierdzenia", at: ts }],
    };
    try {
      await upsertLegacySend(updated);
    } catch (e) {
      fl(`Błąd cofania potwierdzenia: ${e?.message || "spróbuj ponownie"}`, "error");
      return;
    }
    _setSendsRaw(s => s.map(x => x.id === id ? updated : x));
    fl("Potwierdzenie cofnięte", "warning");
  }

  // [B2B Round 5.3] Buyer-open marker: called by PageBuyerDetail useEffect when
  // buyer first opens an unread send. Takes the FULL send object passed via
  // closure from PageBuyerDetail — NOT a stale sends.find() lookup. Uses
  // SECURITY DEFINER RPC because buyer RLS only allows SELECT on legacy_sends.
  // Idempotent at the RPC level — RPC no-ops if status is already past 'sent'.
  async function markSendOpened(send) {
    if (!send || send.status !== "sent") return;
    try {
      await dbMarkLegacySendRead(send.id);
    } catch (e) {
      console.warn("[markSendOpened]", e?.message || e);
      return;
    }
    const ts = nowStr();
    _setSendsRaw(s => s.map(x => x.id === send.id
      ? { ...x, status: "read", readAt: ts, readType: "auto_buyer_open" }
      : x
    ));
  }
  // [B2B Round supplier-FM-UX] Confirm supplier's FM 2026 chain selection.
  // Resolves the company by fmId (or legacySupplierId fallback), persists
  // fm_selection_confirmed_at to Supabase, and updates local companies state
  // so the badge re-renders immediately. Returns the new timestamp or null.
  async function confirmFmSelection() {
    const fmId = account.fmId;
    const co = (companies || []).find(c =>
      c.id === account.id
      || (fmId && (c.fmId === fmId || c.legacy_fm_id === fmId))
      || (account.legacySupplierId && c.legacy_supplier_id === account.legacySupplierId)
    );
    if (!co?.id) {
      fl("Nie udało się znaleźć Twojej firmy w bazie. Skontaktuj się z administratorem.", "error");
      return null;
    }
    let saved;
    try {
      saved = await dbSaveFmSelectionConfirmation(co.id);
    } catch (e) {
      fl(`Błąd potwierdzenia: ${e?.message || "spróbuj ponownie"}`, "error");
      return null;
    }
    const ts = saved?.fm_selection_confirmed_at || new Date().toISOString();
    _setCompaniesRaw(prev => prev.map(c => c.id === co.id ? { ...c, fm_selection_confirmed_at: ts } : c));
    fl("Dziękujemy, Twój wybór sieci został zapisany.");
    return ts;
  }

  async function markThreadRead(targetUserId, recipientRole = account.role) {
    if (!targetUserId) return;
    const unreadIds = (messages || [])
      .filter(m => !m.read)
      .filter(m => recipientRole === "admin"
        ? (m.fromId === targetUserId && m.toId === "admin")
        : (m.fromId === "admin" && m.toId === targetUserId))
      .map(m => m.id);
    if (!unreadIds.length) return;
    try {
      await Promise.all(unreadIds.map(id => dbMarkFmMessageRead(id)));
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, read: true } : m));
    } catch (e) {
      console.warn("[markFmMessageRead]", e);
    }
  }
  async function sendChatMessage(body) {
    const text = String(body || "").trim();
    if (!text || !account?.id || account.role === "admin" || initialRole === "admin") return null;
    try {
      const created = await dbSaveFmMessage({
        thread_key: getFmThreadKey(account.id),
        from_role: account.role,
        to_role: "admin",
        to_user_id: null,
        body: text,
        data: { thread_user_id: account.id }
      });
      const msg = normalizeFmMessage(created);
      setMessages(prev => mergeMessage(prev, msg));
      return msg;
    } catch (e) {
      console.warn("[sendChatMessage]", e);
      return null;
    }
  }
  async function sendAdminReply(targetUserId, targetRole, body) {
    const text = String(body || "").trim();
    if (!text || !targetUserId) return null;
    try {
      const created = await dbSaveFmMessage({
        thread_key: getFmThreadKey(targetUserId),
        from_role: "admin",
        to_role: targetRole || "supplier",
        to_user_id: targetUserId,
        body: text,
        data: { to_user_id: targetUserId }
      });
      const msg = normalizeFmMessage(created);
      setMessages(prev => mergeMessage(prev, msg));
      return msg;
    } catch (e) {
      console.warn("[sendAdminReply]", e);
      return null;
    }
  }
  async function suggestAdminReply(payload) {
    try {
      const res = await dbSuggestAdminChatReplyAI(payload);
      return res?.suggestion || "";
    } catch (e) {
      console.warn("[suggestAdminReply]", e);
      throw e;
    }
  }
  function dismissRefund(id){ setRefundNotifs(n=>n.map(x=>x.id===id?{...x,dismissed:true}:x)); }
  async function runAI(companyDraft, applyDraft){
    setAiLoad(true);
    try {
      const result = await dbGenerateCompanyDescriptionAI({
        company_id: co?.id || null,
        company: companyDraft || co,
      });
      // [B2B Round adaptive-company-profile-ai] AI zwraca dwa opisy w jednym
      // wywołaniu: krótki (2-3 zdania, do podglądu) i standardowy (4-6 zdań,
      // główny opis profilu). Dostawca może zapisać go od razu bez review.
      const patch = {
        description: result?.description || "",
        description_short: result?.description_short || "",
        ai_review_status: "edited",
      };
      if (typeof applyDraft === "function") applyDraft(patch);
      else setCo(prev=>({ ...prev, ...patch }));
      setAiModal(false);
      const tierMsg = result?.richness === "rich" ? "(profil rozszerzony)"
                    : result?.richness === "minimal" ? "(profil krótki — uzupełnij więcej danych dla bogatszego opisu)"
                    : "";
      fl(`${result?.source?.website_used ? "AI przygotował opis na podstawie danych firmy i strony WWW." : "AI przygotował opis na podstawie danych firmy."} ${tierMsg}`.trim());
    } catch (e) {
      console.warn("[generateCompanyDescriptionAI]", e);
      fl(e?.message || "Nie udało się wygenerować opisu firmy.", "warning");
    } finally {
      setAiLoad(false);
    }
  }
  function updateLimit(id,changes){ setLimits(prev=>prev.map(l=>l.id===id?{...l,...changes}:l)); }
  function toggleStar(offerId){ setBuyer(b=>({ ...b, starred: b.starred?.includes(offerId) ? b.starred.filter(x=>x!==offerId) : [...(b.starred||[]),offerId] })); }

  // ── Navigation ─────────────────────────────────────────────────────────
  // Supplier: 5 items  |  Buyer: 2 items  |  Admin: 4 items
  const menuItems = {
    supplier: [[Home,"Dashboard","dashboard"],[Building2,"Firma","company"],[Send,"Wysyłki","wysylki"],[Tag,"Moje propozycje","offers"],[CreditCard,"Finanse","finanse"],[User,"Mój profil","profile"]],
    buyer:    [[Send,"Propozycje asortymentowe","b-offers"],[Building2,"Dostawcy","b-katalog"],[Heart,"Zapisane","b-saved"],[User,"Mój Profil","b-profile"]],
    admin:    [[Home,"Dashboard","a-dash"],[Layers,"Pipeline","a-pipeline"],[Store,"Sieci","a-retailers"],[Building2,"Firmy","a-firmy"]],
  };

  const am = menuItems[role];
  const navKey = pg.startsWith("offer-")?"offers":pg.startsWith("b-det")?"b-offers":pg==="b-dash"?"dashboard":pg==="b-katalog"?"b-katalog":pg==="b-saved"?"b-saved":pg;
  const userName = account.name;

  function switchAccount(acc) {
    setAccount(acc);
    const defaultPg = acc.role==="supplier"?"dashboard":acc.role==="buyer"?"b-offers":"a-dash";
    setPg(defaultPg);
    setSid(null);
    setFlash(null);
  }

  function renderPage(){
    if(pg==="dashboard")    return <PageDashboard offers={offers} sends={sends} nav={nav} rem={rem} wallet={wallet} refundNotifs={refundNotifs} dismissRefund={dismissRefund} fmSettings={fmSettings} accountId={mySupplierKey} co={co} pkgMax={pkgMax} pkgUsed={pkgUsed}/>;
    if(pg==="company")      return <PageCompany co={co} companyId={account.id} setCo={setCo} fl={fl} aiModal={aiModal} setAiModal={setAiModal} aiLoad={aiLoad} runAI={runAI} offers={offers}/>;
    if(pg==="wysylki")      return <PageWysylki sends={sends} offers={offers} pkgUsed={pkgUsed} pkgMax={pkgMax} rem={rem} wallet={wallet} sendToChain={sendToChain} nav={nav} sid={sid} accountId={mySupplierKey} co={co} retailers={retailers} companies={companies}/>;
    if(pg==="offers")       return <PageOffers offers={offers} sends={sends} nav={nav} accountId={mySupplierKey}/>;
    if(pg==="offer-create") return <PageOfferForm offer={null} saveOffer={saveOffer} nav={nav} co={co}/>;
    if(pg==="offer-edit")   return <PageOfferForm offer={offers.find(o=>o.id===sid)} saveOffer={saveOffer} nav={nav} co={co}/>;
    if(pg==="offer-copy")   { const src=offers.find(o=>o.id===sid); const copy=src?{...src,id:undefined,status:"draft",title:(src.title||src.product||"")+" (Kopia)",product:(src.product||"")+" (Kopia)",internalTitle:src.internalTitle?src.internalTitle+" (Kopia)":undefined}:null; return <PageOfferForm offer={copy} saveOffer={saveOffer} nav={nav} co={co}/>; }
    if(pg==="finanse")      return <PageFinanse wallet={wallet} sends={sends} offers={offers} co={co} setCo={setCo} fl={fl} nav={nav} buyPackage={buyPackage} orders={orders} pkgMax={pkgMax} pkgUsed={pkgUsed} retailers={retailers} accountId={mySupplierKey}/>;
    if(pg==="profile")      return <PageSupplierProfile account={account} co={co} fl={fl}/>;
    if(pg==="b-dash")       return <PageBuyerDashboard nav={nav} fmSettings={fmSettings} buyer={buyer} sends={sends} buyerRetailerId={account.retailerId || CHAIN_TO_RETAILER[account.chainId]}/>;
    if(pg==="b-offers")     return <PageBuyerOffers sends={sends} offers={offers} nav={nav} buyer={buyer} toggleStar={toggleStar} co={co} buyerRetailerId={account.retailerId || CHAIN_TO_RETAILER[account.chainId]} retailers={retailers} companies={companies}/>;
    if(pg==="b-saved")      return <PageBuyerOffers sends={sends} offers={offers} nav={nav} buyer={buyer} toggleStar={toggleStar} co={co} buyerRetailerId={account.retailerId || CHAIN_TO_RETAILER[account.chainId]} retailers={retailers} companies={companies} initialFilter={{ starred:true }}/>;
    if(pg==="b-katalog")    return <PageBuyerCatalog companies={companies} offers={offers} nav={nav} sends={sends} buyerRetailerId={account.retailerId || CHAIN_TO_RETAILER[account.chainId]} role={account.role}/>;
    if(pg==="b-profile")    return <PageBuyerProfile buyer={buyer} setBuyer={setBuyer} fl={fl}/>;
    if(pg==="b-detail")     return <PageBuyerDetail send={(sends||[]).find(s=>s.id===sid)} offers={offers} co={co} nav={nav} buyer={buyer} toggleStar={toggleStar} companies={companies} buyerRetailerId={account.retailerId || CHAIN_TO_RETAILER[account.chainId]} sends={sends} onOpened={markSendOpened}/>;
    if(pg==="a-dash")       return <PageAdminDash sends={sends} nav={nav} fmSettings={fmSettings} fmPrefs={fmPrefs} fmResps={fmResps} fmSchedule={fmSchedule} resetToSeed={resetToSeed} retailers={retailers} fmSuppliers={fmSuppliers}/>;
    if(pg==="a-pipeline")   return <PageAdminPipeline sends={sends} setSends={setSends} offers={offers} moderate={moderate} sendApproved={sendApproved} updateSendDate={updateSendDate} updateSendPos={updateSendPos} confirmManual={confirmManual} undoConfirm={undoConfirm} fl={fl} retailers={retailers} companies={companies}/>;
    if(pg==="a-retailers")  return <PageAdminRetailers retailers={retailers} setRetailers={setRetailers}/>;
    if(pg==="a-firmy")      return <PageAdminFirmy limits={limits} updateLimit={updateLimit} sends={sends} offers={offers} orders={orders} fl={fl} retailers={retailers} companies={companies} setCompanies={setCompanies} dbCapacity={dbCapacity} refreshCapacity={refreshCapacity}/>;
    if(pg==="a-chat")       return <PageAdminChat messages={messages} runtimeAccounts={runtimeAccounts} onSendReply={sendAdminReply} onMarkThreadRead={markThreadRead} onSuggestReply={suggestAdminReply}/>;
    // Supplier FM sub-pages all route to PageSupplierFM with subPage prop
    if(["fm-sched","fm-algo","fm-wyniki"].includes(pg)) return role==="supplier"
      ? <PageSupplierFM fmId={account.fmId||"s1"} fmSettings={fmSettings} fmPrefs={fmPrefs} setFmPrefs={setFmPrefs} fmResps={fmResps} fmAlgo={fmAlgo} fmSchedule={fmSchedule} setFmSchedule={setFmSchedule} subPage={pg} fmChains={fmChains} fmSuppliers={fmSuppliers} companies={companies} offers={offers} previewFor={previewFor} retailers={retailers} accountId={account.id} confirmFmSelection={confirmFmSelection}/>
      : <PageBuyerFM chainId={account.chainId||"ch5"} fmSettings={fmSettings} fmPrefs={fmPrefs} fmResps={fmResps} setFmResps={setFmResps} fmAlgo={fmAlgo} fmSchedule={fmSchedule} fmChains={fmChains} fmSuppliers={fmSuppliers} companies={companies} offers={offers} sends={sends} fmWishlists={fmWishlists} setFmWishlists={setFmWishlists} fmLateResps={fmLateResps} setFmLateResps={setFmLateResps} previewFor={previewFor} retailers={retailers}/>;
    if(pg==="a-fm")         return <PageAdminFM fmSettings={fmSettings} setFmSettings={setFmSettings} fmPrefs={fmPrefs} fmResps={fmResps} setFmResps={setFmResps} fmAlgo={fmAlgo} fmSchedule={fmSchedule} setFmSchedule={setFmSchedule} onRegenerate={onFMRegenerate} retailers={retailers} setRetailers={setRetailers} fmChains={fmChains} fmSuppliers={fmSuppliers} fmWishlists={fmWishlists} fmLateResps={fmLateResps} previewFor={previewFor} setPreviewFor={setPreviewFor} runtimeAccounts={runtimeAccounts} companies={companies}/>;
    return null;
  }

  const activeRefunds = refundNotifs.filter(n => !n.dismissed && (!n.supplierId || n.supplierId === mySupplierKey));

  return (
    <div style={{ fontFamily:"system-ui,-apple-system,sans-serif",background:"#f1f5f9",minHeight:"100vh",color:"#1e293b",fontSize:14 }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      {/* Account switcher — tylko dla admina (dostawca/kupiec ma zablokowaną rolę) */}
      {!lockedRole && (
        <AccountSwitcherBar account={account} accounts={runtimeAccounts} onSwitch={switchAccount} wallet={wallet} fmSettings={fmSettings} retailers={retailers}/>
      )}
      <div style={{ display:"flex",minHeight:"calc(100vh - 36px)" }}>
        {/* Sidebar */}
        <aside style={{ width:220,background:"#0f172a",flexShrink:0,display:"flex",flexDirection:"column" }}>
          <div style={{ padding:"14px 16px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
            {/* [B2B Round branding-and-header-logos] zamiast emoji 🍎 + tekst —
                inline SVG logo Fresh Market (variant="light", białe litery na
                ciemnym sidebarze #0f172a). Sidebar = brand systemowy, zawsze FM. */}
            <FreshMarketLogo variant="light" size={22} />
          </div>
          <nav style={{ flex:1,padding:"8px 8px",overflowY:"auto" }}>
            {/* ── DASHBOARD (not for buyer — their main page is Propozycje) ── */}
            {role!=="buyer" && (
              <div onClick={()=>nav("dashboard")} style={{ display:"flex",alignItems:"center",gap:9,padding:"9px 14px",color:navKey==="dashboard"?"white":"#64748b",background:navKey==="dashboard"?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:4,cursor:"pointer",fontSize:13,fontWeight:navKey==="dashboard"?600:400,transition:"all 0.15s" }}>
                <Home size={14}/><span>Dashboard</span>
              </div>
            )}

            {/* ── SUPPLIER NAV ── */}
            {role==="supplier"&&<>
              <div style={{ padding:"5px 14px 3px",marginTop:2 }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>PreConnect</span>
              </div>
              {[[Send,"Wysyłki","wysylki"],[Tag,"Moje propozycje","offers"],[CreditCard,"Finanse","finanse"],[Building2,"Twoja firma","company"],[User,"Mój profil","profile"]].map(([Ic,label,key])=>(
                <div key={key} onClick={()=>nav(key)} style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 14px",color:navKey===key?"white":"#64748b",background:navKey===key?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:1,cursor:"pointer",fontSize:13,fontWeight:navKey===key?600:400,transition:"all 0.15s" }}>
                  <Ic size={14}/><span>{label}</span>
                  {key==="finanse"&&wallet.balance>0&&<span style={{ marginLeft:"auto",background:"#059669",color:"white",borderRadius:10,fontSize:10,fontWeight:700,padding:"1px 6px" }}>{wallet.balance}€</span>}
                </div>
              ))}
              <div style={{ padding:"8px 14px 3px",marginTop:6,borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>Fresh Market 2026</span>
              </div>
              {/* [B2B Round supplier-onboarding-access-and-communication]
                  Dwie warstwy locka:
                    1. fmSettings.schedulingOpen — globalny flag (admin otwiera fazę)
                    2. co.fm_b2b_enabled — per-supplier (admin dopuszcza firmę do FM B2B)
                  Jedno LUB drugie = lock. Tooltip mówi czego brakuje. */}
              {!fmSettings.schedulingOpen || !co?.fm_b2b_enabled
                ? <div title={!co?.fm_b2b_enabled ? "Spotkania B2B są aktywowane indywidualnie przez administratora dla Twojej firmy." : "Faza Spotkań B2B nie jest jeszcze otwarta."} style={{ display:"flex",alignItems:"center",gap:9,padding:"9px 14px",color:"#475569",borderRadius:8,marginBottom:1,cursor:"not-allowed",fontSize:13 }}>
                    <Calendar size={14}/><span style={{ opacity:0.5 }}>Spotkania FM 2026</span>
                    <span style={{ marginLeft:"auto",fontSize:10,color:"#475569" }}>🔒</span>
                  </div>
                : [
                    {key:"fm-sched",label:"Wybór sieci",  Icon:Store,   unlocked:true},
                    {key:"fm-algo", label:"Algorytm",      Icon:Zap,     unlocked:fmSettings.currentPhase>=3},
                    // fm-korekty tab removed — supplier corrections are handled via admin chat
                    {key:"fm-wyniki",label:"Twoje spotkania",Icon:Calendar,unlocked:fmSettings.planPublished},
                  ].map(s=>{
                    const isActive = navKey===s.key || (navKey==="fm-sched"&&s.key==="fm-sched");
                    const SIc = s.Icon;
                    return (
                      <div key={s.key}
                        onClick={()=>{ if(s.unlocked) nav(s.key); }}
                        style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 14px 8px 22px",color:isActive?"white":s.unlocked?"#64748b":"#334155",background:isActive?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:1,cursor:s.unlocked?"pointer":"not-allowed",fontSize:12,fontWeight:isActive?600:400,opacity:s.unlocked?1:0.4,transition:"all 0.15s" }}>
                        <SIc size={13}/><span>{s.label}</span>
                        {!s.unlocked&&<span style={{ marginLeft:"auto",fontSize:9 }}>🔒</span>}
                        {isActive&&<span style={{ marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:"white" }}/>}
                      </div>
                    );
                  })
              }
            </>}

            {/* ── BUYER NAV ── */}
            {role==="buyer"&&<>
              <div style={{ padding:"5px 14px 3px",marginTop:2 }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>PreConnect</span>
              </div>
              {[[Send,"Propozycje asortymentowe","b-offers"],[Building2,"Dostawcy","b-katalog"],[Heart,"Zapisane","b-saved"],[User,"Mój Profil","b-profile"]].map(([Ic,label,key])=>(
                <div key={key} onClick={()=>nav(key)} style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 14px",color:navKey===key?"white":"#64748b",background:navKey===key?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:1,cursor:"pointer",fontSize:13,fontWeight:navKey===key?600:400,transition:"all 0.15s" }}>
                  <Ic size={14}/><span>{label}</span>
                </div>
              ))}
              <div style={{ padding:"5px 14px 3px",marginTop:4 }}/>
              <div style={{ padding:"8px 14px 3px",marginTop:6,borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>Fresh Market 2026</span>
              </div>
              <div onClick={()=>fmSettings.schedulingOpen&&nav("fm-sched")} style={{ display:"flex",alignItems:"center",gap:9,padding:"9px 14px",color:navKey==="fm-sched"?"white":"#64748b",background:navKey==="fm-sched"?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,cursor:fmSettings.schedulingOpen?"pointer":"not-allowed",fontSize:13,opacity:fmSettings.schedulingOpen?1:0.5,fontWeight:navKey==="fm-sched"?600:400 }}>
                <Calendar size={14}/><span>Spotkania FM 2026</span>
                {!fmSettings.schedulingOpen&&<span style={{ marginLeft:"auto",fontSize:10 }}>🔒</span>}
              </div>
            </>}

            {/* ── ADMIN NAV ── */}
            {role==="admin"&&<>
              <div style={{ padding:"5px 14px 3px",marginTop:2 }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>Admin</span>
              </div>
              {[[Layers,"Pipeline","a-pipeline"],[Store,"Sieci","a-retailers"],[Building2,"Firmy","a-firmy"]].map(([Ic,label,key])=>{
                // [B2B Round supplier-onboarding-access-and-communication]
                // Badge przy "Firmy" pokazuje liczbę dostawców czekających na
                // zatwierdzenie. Liczone z lokalnego state companies (po
                // bulkUpsert wraca z DB więc badge jest świeży).
                const pendingForFirmy = key === "a-firmy"
                  ? (companies || []).filter(c => c.account_status === "pending_review").length
                  : 0;
                return (
                  <div key={key} onClick={()=>nav(key)} style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 14px",color:navKey===key?"white":"#64748b",background:navKey===key?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:1,cursor:"pointer",fontSize:13,fontWeight:navKey===key?600:400,transition:"all 0.15s" }}>
                    <Ic size={14}/><span>{label}</span>
                    {pendingForFirmy>0 && <span title={`${pendingForFirmy} firm czeka na zatwierdzenie`} style={{ marginLeft:"auto",background:"#d97706",color:"white",borderRadius:10,fontSize:9,fontWeight:700,padding:"1px 6px",flexShrink:0 }}>{pendingForFirmy}</span>}
                  </div>
                );
              })}
              {(()=>{
                const unread = messages.filter(m=>m.toId==="admin"&&!m.read).length;
                return (
                  <div onClick={()=>nav("a-chat")} style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 14px",color:navKey==="a-chat"?"white":"#64748b",background:navKey==="a-chat"?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,marginBottom:1,cursor:"pointer",fontSize:13,fontWeight:navKey==="a-chat"?600:400,transition:"all 0.15s" }}>
                    <MessageSquare size={14}/><span>Wiadomości</span>
                    {unread>0&&<span style={{ marginLeft:"auto",background:"#dc2626",color:"white",borderRadius:"50%",fontSize:9,fontWeight:700,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>{unread>9?"9+":unread}</span>}
                  </div>
                );
              })()}
              <div style={{ padding:"8px 14px 3px",marginTop:6,borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700 }}>Fresh Market 2026</span>
              </div>
              <div onClick={()=>nav("a-fm")} style={{ display:"flex",alignItems:"center",gap:9,padding:"9px 14px",color:navKey==="a-fm"?"white":"#64748b",background:navKey==="a-fm"?"rgba(13,148,136,0.85)":"transparent",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:navKey==="a-fm"?600:400 }}>
                <Settings size={14}/><span>FM Spotkania</span>
                <span style={{ marginLeft:"auto",background:fmSettings.planPublished?"rgba(5,150,105,0.3)":fmSettings.schedulingOpen?"rgba(37,99,235,0.3)":"rgba(220,38,38,0.25)",color:fmSettings.planPublished?"#6ee7b7":fmSettings.schedulingOpen?"#93c5fd":"#fca5a5",borderRadius:8,fontSize:9,fontWeight:700,padding:"2px 6px" }}>{fmSettings.planPublished?"Opublikowany":fmSettings.schedulingOpen?"Aktywna":"Zamknięta"}</span>
              </div>
            </>}
          </nav>
          <div style={{ padding:12,borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ width:28,height:28,borderRadius:"50%",background:"#334155",display:"flex",alignItems:"center",justifyContent:"center" }}><User size={12} color="#64748b"/></div>
            <div><div style={{ color:"#cbd5e1",fontSize:11 }}>{userName}</div><div style={{ color:"#475569",fontSize:10 }}>{role}</div></div>
          </div>
        </aside>
        {/* Main content */}
        <main style={{ flex:1,minWidth:0,padding:"20px 24px" }}>
          {/* [B2B Round supplier-onboarding-access-and-communication]
              Banner statusu konta — pokazuje supplerowi co aktualnie ma odblokowane.
              Dla 'active' z full uprawnieniami banner się nie pokazuje (nie spamujemy
              komunikatami zalogowanego seniorowi). Dla pending / partial / off
              widać dlaczego niektóre rzeczy są zablokowane. */}
          {role === "supplier" && co?.id && (() => {
            const status = co.account_status || "active";
            const preOk = !!co.preconnect_enabled;
            const fmOk = !!co.fm_b2b_enabled;
            // Pełna aktywacja + oba moduły = nic nie pokazuj
            if (status === "active" && preOk && fmOk) return null;
            if (status === "pending_review") {
              const mailSubj = encodeURIComponent(`Aktywacja konta — ${co.name || "Fresh Market B2B"}`);
              const mailBody = encodeURIComponent(`Dzień dobry,\n\nProszę o aktywację konta firmy ${co.name || "(brak nazwy)"} w panelu Fresh Market B2B (PreConnect + Spotkania FM 2026).\n\nDziękuję.`);
              return <div style={{ background:"#fef3c7",border:"1.5px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start" }}>
                <Clock size={16} color="#92400e" style={{ flexShrink:0,marginTop:2 }}/>
                <div style={{ flex:1,fontSize:13,color:"#78350f" }}>
                  <strong>Konto oczekuje na zatwierdzenie.</strong> Możesz uzupełnić profil firmy, wgrać logo i certyfikaty. Po aktywacji przez administratora odblokujemy wysyłkę ofert do sieci (PreConnect) oraz Spotkania B2B.
                </div>
                <a href={`mailto:newsletter@freshmarket.eu?subject=${mailSubj}&body=${mailBody}`} style={{ padding:"7px 12px",background:"#d97706",color:"white",borderRadius:7,fontSize:12,fontWeight:600,textDecoration:"none",flexShrink:0,whiteSpace:"nowrap" }}>
                  Napisz do admina
                </a>
              </div>;
            }
            if (status === "rejected") {
              return <div style={{ background:"#fee2e2",border:"1.5px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start" }}>
                <AlertTriangle size={16} color="#dc2626" style={{ flexShrink:0,marginTop:2 }}/>
                <div style={{ flex:1,fontSize:13,color:"#991b1b" }}>
                  <strong>Rejestracja nie została aktywowana.</strong>{co.status_note ? ` ${co.status_note}` : ""} Skontaktuj się z <a href="mailto:newsletter@freshmarket.eu" style={{color:"#0d9488"}}>newsletter@freshmarket.eu</a>.
                </div>
              </div>;
            }
            if (status === "suspended") {
              return <div style={{ background:"#fee2e2",border:"1.5px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start" }}>
                <AlertTriangle size={16} color="#dc2626" style={{ flexShrink:0,marginTop:2 }}/>
                <div style={{ flex:1,fontSize:13,color:"#991b1b" }}>
                  <strong>Konto zostało wstrzymane.</strong>{co.status_note ? ` ${co.status_note}` : ""} Profil firmy pozostaje dostępny, wysyłki i Spotkania B2B są zablokowane do czasu wyjaśnienia.
                </div>
              </div>;
            }
            // status === "active" ale któryś moduł off — komunikat informacyjny z CTA
            const offBits = [];
            if (!preOk) offBits.push("PreConnect (wysyłka ofert do sieci) jest jeszcze nieaktywny");
            if (!fmOk) offBits.push("Spotkania B2B Fresh Market 2026 są aktywowane indywidualnie przez administratora");
            const missingMods = [!preOk && "PreConnect", !fmOk && "Spotkania FM 2026"].filter(Boolean).join(" + ");
            const mailSubj = encodeURIComponent(`Aktywacja ${missingMods} — ${co.name || "Fresh Market B2B"}`);
            const mailBody = encodeURIComponent(`Dzień dobry,\n\nProszę o aktywację modułów ${missingMods} dla firmy ${co.name || "(brak nazwy)"} w panelu Fresh Market B2B.\n\nDziękuję.`);
            return <div style={{ background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start" }}>
              <Info size={16} color="#3b82f6" style={{ flexShrink:0,marginTop:2 }}/>
              <div style={{ flex:1,fontSize:12,color:"#1e3a5f" }}>
                <strong>Konto jest aktywne.</strong> {offBits.join(". ")}.
              </div>
              <a href={`mailto:newsletter@freshmarket.eu?subject=${mailSubj}&body=${mailBody}`} style={{ padding:"6px 12px",background:"#3b82f6",color:"white",borderRadius:7,fontSize:11,fontWeight:600,textDecoration:"none",flexShrink:0,whiteSpace:"nowrap" }}>
                Poproś o aktywację
              </a>
            </div>;
          })()}
          {account.role==="supplier"&&pg!=="fm-sched"&&activeRefunds.map(n=>(
            <div key={n.id} style={{ background:"#fffbeb",border:"1.5px solid #fbbf24",borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",gap:10,alignItems:"flex-start" }}>
              <RotateCcw size={16} color="#d97706" style={{ flexShrink:0,marginTop:2 }}/>
              <div style={{ flex:1,fontSize:13,color:"#92400e" }}><strong>Zwrot {n.amount} EUR</strong> — {n.msg}</div>
              <div style={{ display:"flex",gap:6,flexShrink:0 }}>
                <Btn sm onClick={()=>{dismissRefund(n.id);nav("wysylki");}} style={{ background:"#d97706",color:"white",border:"none" }}><Send size={10}/> Wyślij dalej</Btn>
                <button onClick={()=>dismissRefund(n.id)} style={{ background:"none",border:"none",cursor:"pointer",color:"#92400e",padding:2 }}><X size={14}/></button>
              </div>
            </div>
          ))}
          {flash&&<Alrt type={flash.t}>{flash.m}</Alrt>}
          {renderPage()}
        </main>
        {(role==="supplier"||role==="buyer")&&(
          <FloatingChat account={account} messages={messages} onSendMessage={sendChatMessage} onMarkThreadRead={markThreadRead}/>
        )}
      </div>
    </div>
  );
}
/* ══════════════════════════════════════════════════════════════════════════
   SUPPLIER PAGES
══════════════════════════════════════════════════════════════════════════ */

/* ── Dashboard: 2 main blocks — PreConnect + FM 2026 ────────────────────── */
function PageDashboard({ offers, sends, nav, rem, wallet, refundNotifs, dismissRefund, fmSettings, accountId, co, pkgMax, pkgUsed }) {
  const mySends    = (sends||[]).filter(s=>!s.supplierId||s.supplierId===accountId);
  const confirmed  = mySends.filter(s=>["read","read_manual"].includes(s.status)).length;
  const pending    = mySends.filter(s=>s.status==="sent").length;
  const refunds    = (refundNotifs||[]).filter(
    n => !n.dismissed && (!n.supplierId || n.supplierId === accountId)
  );
  const fmOpen = fmSettings?.schedulingOpen;
  const [howOpenSup, setHowOpenSup] = useState(false);

  // [B2B Round prod-rollout / UX] Checklist startowa — 5 kroków do pełnej
  // gotowości supplera. Pokazuje się dopóki co najmniej jeden krok jest do
  // zrobienia. Po wszystkich ✓ — chowamy całą kartę (LS flag).
  const onboardingDoneLs = typeof window !== "undefined" && window.localStorage
    ? window.localStorage.getItem("fm_supplier_onboard_dismissed") === "1"
    : false;
  const [hideOnboarding, setHideOnboarding] = useState(onboardingDoneLs);
  const myOffersCount = (offers || []).filter(o => !o.supplierId || o.supplierId === accountId).length;
  const mySendsCount = (sends || []).filter(s => !s.supplierId || s.supplierId === accountId).length;
  const onbSteps = [
    {
      key: "profile",
      label: "Uzupełnij dane firmy",
      hint: "Nazwa, NIP, kraj, krótki opis — minimum żeby kupiec wiedział kogo dotyczy oferta.",
      done: !!(co?.name && co?.country && (co?.description || co?.description_short)),
      cta: "Otwórz profil firmy",
      goto: "company",
    },
    {
      key: "logo",
      label: "Wgraj logo firmy",
      hint: "Pokazuje się w mailu do kupca i przy ofertach. PNG/JPG, kwadrat ~400×400 px.",
      done: !!(co?.logo_url || co?.logo),
      cta: "Wgraj logo",
      goto: "company",
    },
    {
      key: "offer",
      label: "Dodaj pierwszą propozycję",
      hint: "Produkt + krótka specyfikacja + 1-3 zdjęcia. To podstawa wysyłki do sieci.",
      done: myOffersCount > 0,
      cta: "Dodaj propozycję",
      goto: "offers",
    },
    {
      key: "package",
      label: "Aktywuj pakiet wysyłek",
      hint: "Każda wysyłka do sieci kosztuje 1 kredyt z pakietu. Bez pakietu nie wyślesz.",
      done: Number(pkgMax || 0) > 0 || Number(rem || 0) > 0,
      cta: "Wybierz pakiet",
      goto: "finanse",
    },
    {
      key: "send",
      label: "Wyślij propozycję do sieci",
      hint: "Wybierz sieć z listy w Wysyłkach i kliknij Wyślij. Pierwsza wysyłka = punkt zwrotny.",
      done: mySendsCount > 0,
      cta: "Wyślij propozycję",
      goto: "wysylki",
    },
  ];
  const onbDoneCount = onbSteps.filter(s => s.done).length;
  const allOnbDone = onbDoneCount === onbSteps.length;
  function dismissOnboarding() {
    try { window.localStorage.setItem("fm_supplier_onboard_dismissed", "1"); } catch (e) {}
    setHideOnboarding(true);
  }

  return (
    <div style={{ maxWidth:860 }}>

      {/* ── Checklist startowa — 5 kroków do gotowości ── */}
      {!hideOnboarding && !allOnbDone && (
        <div style={{ marginBottom:16,background:"white",borderRadius:12,border:"1px solid #e2e8f0",padding:"16px 18px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ fontWeight:700,fontSize:14,color:"#1e293b" }}>
              Zacznij tutaj <span style={{ color:"#64748b",fontWeight:500,marginLeft:6 }}>({onbDoneCount}/{onbSteps.length})</span>
            </div>
            <div style={{ flex:1,height:6,background:"#f1f5f9",borderRadius:99,margin:"0 14px",overflow:"hidden" }}>
              <div style={{ width:`${(onbDoneCount/onbSteps.length)*100}%`,height:"100%",background:"#0d9488",transition:"width 0.3s" }}/>
            </div>
            <button onClick={dismissOnboarding} title="Schowaj checklistę" style={{ background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:4 }}>
              <X size={14}/>
            </button>
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {onbSteps.map(step => (
              <div key={step.key} style={{ display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",background:step.done?"#f0fdf4":"#f8fafc",borderRadius:8,border:`1px solid ${step.done?"#bbf7d0":"#e2e8f0"}` }}>
                <div style={{ width:22,height:22,borderRadius:"50%",background:step.done?"#0d9488":"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1 }}>
                  {step.done ? <CheckCircle size={14} color="white"/> : <span style={{ fontSize:11,fontWeight:700,color:"#64748b" }}>{onbSteps.indexOf(step)+1}</span>}
                </div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:600,fontSize:13,color:step.done?"#065f46":"#1e293b" }}>{step.label}</div>
                  {!step.done && <div style={{ fontSize:12,color:"#64748b",marginTop:2,lineHeight:1.5 }}>{step.hint}</div>}
                </div>
                {!step.done && (
                  <button onClick={()=>nav(step.goto)} style={{ padding:"6px 12px",background:"#0d9488",color:"white",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"inherit" }}>
                    {step.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Jak to działa? — Supplier ── */}
      <div style={{ marginBottom:20,background:"white",borderRadius:12,border:"1px solid #e2e8f0",overflow:"hidden" }}>
        <div onClick={()=>setHowOpenSup(v=>!v)} style={{ display:"flex",alignItems:"center",gap:10,padding:"13px 18px",cursor:"pointer",userSelect:"none" }}>
          <Info size={15} color="#2563eb"/>
          <span style={{ fontWeight:700,fontSize:14,color:"#1e293b",flex:1 }}>Jak to działa?</span>
          <span style={{ fontSize:12,color:"#94a3b8" }}>{howOpenSup?"Zwiń ▲":"Rozwiń ▼"}</span>
        </div>
        {howOpenSup && (
          <div style={{ padding:"0 18px 18px",borderTop:"1px solid #f1f5f9" }}>
            <p style={{ fontSize:13,color:"#334155",lineHeight:1.7,marginTop:14,marginBottom:12 }}>
              Witaj na platformie Fresh Market! Twój panel dzieli się na dwa główne moduły: <strong>PreConnect</strong> (całoroczna wysyłka propozycji) oraz <strong>Spotkania FM 2026</strong> (rejestracja na fizyczne spotkania B2B).
            </p>

            <div style={{ fontWeight:700,fontSize:13,color:"#0d9488",marginBottom:8,display:"flex",alignItems:"center",gap:6 }}>
              <Send size={13}/> Moduł PreConnect (Całoroczny)
            </div>
            <ul style={{ margin:"0 0 14px 0",paddingLeft:18,display:"flex",flexDirection:"column",gap:7 }}>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Tworzenie propozycji asortymentowej:</strong> Przejdź do zakładki <em>Moje propozycje</em> i kliknij <em>Dodaj propozycję asortymentową</em>. Możesz nadać własną nazwę (widoczną tylko dla Ciebie). Cena jest opcjonalna i ma charakter orientacyjny.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Duplikowanie:</strong> Masz podobne produkty? Użyj przycisku <em>Duplikuj</em> przy istniejącej propozycji — skopiujesz produkt, dane logistyczne, certyfikaty i opakowanie. Tylko zmień to, co się różni.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Wysyłanie do Sieci:</strong> Przejdź do <em>Wysyłki → Sieci handlowe</em>. Znajdź sieć, sprawdź preferencje kupców i kliknij <em>Wyślij propozycję</em>. Z Twojego konta zostanie pobrany 1 kredyt.</li>
              <li style={{ fontSize:12,color:"#059669",lineHeight:1.65,background:"#f0fdf4",padding:"6px 10px",borderRadius:7,listStyle:"none",marginLeft:-18,border:"1px solid #bbf7d0" }}>⭐ <strong>Złota zasada 14 dni:</strong> Wysyłki realizowane są w pierwszy wtorek każdego miesiąca. Jeśli kupiec nie otworzy propozycji w ciągu 14 dni – kredyt automatycznie wraca na Twój portfel!</li>
            </ul>

            <div style={{ fontWeight:700,fontSize:13,color:"#7c3aed",marginBottom:8,display:"flex",alignItems:"center",gap:6 }}>
              <Calendar size={13}/> Moduł Spotkania FM 2026 (Targi)
            </div>
            <ul style={{ margin:"0 0 10px 0",paddingLeft:18,display:"flex",flexDirection:"column",gap:7 }}>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Preferencje (do 16 września):</strong> Wybierz maks. 5 głównych sieci (⭐) oraz sieci rezerwowe (👍), z którymi chcesz się spotkać.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Wyniki (od 22 września):</strong> Algorytm i Administrator ułożą grafik. W zakładce <em>Twoje spotkania</em> zobaczysz numery spotkań i profile dopasowanych sieci.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Masz problem?</strong> W prawym dolnym rogu znajdziesz ikonę czatu. Napisz do nas — Administrator jest do Twojej dyspozycji!</li>
            </ul>
          </div>
        )}
      </div>

      {/* ════ STAŁY PANEL INFO: SPOTKANIA FM 2026 ════ */}
      {/* [B2B Round supplier-FM-UX] Persistent info block. Visible regardless of
          schedulingOpen — supplier always knows the timeline and where to ask
          for help. Greyed when fmOpen=false but text stays readable. */}
      <div style={{ marginBottom:16,padding:"16px 18px",background:fmOpen?"#fffbeb":"#f8fafc",border:`1px solid ${fmOpen?"#fde68a":"#e2e8f0"}`,borderRadius:12 }}>
        <div style={{ fontWeight:700,fontSize:13,color:fmOpen?"#92400e":"#475569",marginBottom:10,display:"flex",alignItems:"center",gap:7 }}>
          <Calendar size={14}/> Moduł Spotkania FM 2026 (Targi)
          {!fmOpen && <span style={{ marginLeft:6,fontSize:10,fontWeight:700,color:"#94a3b8",background:"#f1f5f9",padding:"2px 8px",borderRadius:20 }}>🔒 ZAMKNIĘTE</span>}
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,fontSize:12,color:fmOpen?"#334155":"#64748b",lineHeight:1.6 }}>
          <div>
            <div style={{ fontWeight:700,marginBottom:3,color:fmOpen?"#1e293b":"#475569" }}>Preferencje do 16 września</div>
            <div>Wybierz maksymalnie 5 głównych sieci oznaczonych gwiazdką ⭐ oraz sieci rezerwowe oznaczone 👍, z którymi chcesz się spotkać.</div>
          </div>
          <div>
            <div style={{ fontWeight:700,marginBottom:3,color:fmOpen?"#1e293b":"#475569" }}>Wyniki od 22 września</div>
            <div>Algorytm i Administrator ułożą grafik. W zakładce <em>Twoje spotkania</em> zobaczysz numery spotkań oraz profile dopasowanych sieci.</div>
          </div>
          <div>
            <div style={{ fontWeight:700,marginBottom:3,color:fmOpen?"#1e293b":"#475569" }}>Masz problem?</div>
            <div>W prawym dolnym rogu znajdziesz ikonę czatu. Napisz do nas — Administrator jest do Twojej dyspozycji.</div>
          </div>
        </div>
      </div>

      {/* [B2B Round supplier-FM-UX] Tile order depends on schedulingOpen.
          fmOpen=true  → Spotkania B2B FIRST (most important now), PreConnect SECOND
          fmOpen=false → PreConnect FIRST (default daily flow), Spotkania SECOND (greyed) */}
      {(() => {
        const preConnectTile = (
          <div key="preconnect" style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:16,padding:"28px 28px",marginBottom:16 }}>
            <div style={{ display:"flex",alignItems:"flex-start",gap:14,marginBottom:20 }}>
              <div style={{ width:48,height:48,borderRadius:12,background:"rgba(13,148,136,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                <Send size={22} color="#6ee7b7"/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:"white",fontWeight:800,fontSize:18,marginBottom:8 }}>PreConnect</div>
                <div style={{ color:"rgba(255,255,255,0.7)",fontSize:13,lineHeight:1.8,maxWidth:580 }}>
                  Wyślij swoje <strong style={{ color:"#6ee7b7" }}>propozycje asortymentowe</strong> bezpośrednio do sieci handlowej z gwarancją przeczytania.<br/>
                  Jeżeli kupiec nie zapozna się z propozycją w ciągu 14 dni, zwrócimy Twoje pieniądze.<br/>
                  Wysyłki realizowane są w pierwszy wtorek każdego miesiąca.
                </div>
                {refunds.length>0&&(
                  <div style={{ marginTop:12,padding:"10px 14px",background:"rgba(251,191,36,0.15)",border:"1px solid rgba(251,191,36,0.4)",borderRadius:9,fontSize:12,color:"#fbbf24" }}>
                    {refunds.length === 1
                      ? `Zwrot ${refunds[0].amount} EUR — ${refunds[0].msg}`
                      : `${refunds.length} zwroty kredytu czekają na Twój panel.`
                    }
                  </div>
                )}
                {pending>0&&(
                  <div style={{ marginTop:8,padding:"8px 12px",background:"rgba(234,88,12,0.15)",border:"1px solid rgba(234,88,12,0.35)",borderRadius:9,fontSize:12,color:"#fed7aa" }}>
                    {pending} {pending===1?"propozycja":"propozycje"} w trakcie — oczekuje na odczyt przez kupca (max 14 dni).
                  </div>
                )}
                {confirmed>0&&(
                  <div style={{ marginTop:8,padding:"8px 12px",background:"rgba(5,150,105,0.15)",border:"1px solid rgba(5,150,105,0.4)",borderRadius:9,fontSize:12,color:"#6ee7b7" }}>
                    {confirmed} {confirmed===1?"propozycja przeczytana":"propozycje przeczytane"} — kupcy zapoznali się z Twoimi propozycjami.
                  </div>
                )}
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <button onClick={()=>nav("wysylki")} style={{ padding:"14px 18px",background:"rgba(13,148,136,0.85)",border:"1px solid rgba(13,148,136,0.5)",borderRadius:10,color:"white",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:10 }}>
                <Send size={17}/><div><div style={{ fontWeight:700,fontSize:14 }}>Nowa wysyłka</div><div style={{ fontSize:11,opacity:0.75,marginTop:2 }}>{rem} wysyłek w pakiecie</div></div>
              </button>
              <button onClick={()=>nav("offers")} style={{ padding:"14px 18px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,color:"white",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:10 }}>
                <Tag size={17}/><div><div style={{ fontWeight:700,fontSize:14 }}>Moje propozycje</div><div style={{ fontSize:11,opacity:0.65,marginTop:2 }}>{offers.filter(o=>o.status==="active").length} opublikowanych · {offers.filter(o=>o.status==="draft").length} szkiców</div></div>
              </button>
            </div>
          </div>
        );

        const fmTile = (
          <div key="fm" onClick={fmOpen?()=>nav(resolveFMRoute(fmSettings)):undefined} style={{ borderRadius:16,border:fmOpen?"2px solid #059669":"1px solid #e2e8f0",background:fmOpen?"linear-gradient(135deg,#f0fdf4,#ecfdf5)":"white",padding:"28px 28px",marginBottom:16,position:"relative",overflow:"hidden",cursor:fmOpen?"pointer":"default" }}>
            {!fmOpen&&<div style={{ position:"absolute",top:0,left:0,right:0,height:4,background:"linear-gradient(90deg,#e2e8f0,#f1f5f9)" }}/>}
            <div style={{ display:"flex",alignItems:"flex-start",gap:14,marginBottom:20 }}>
              <div style={{ width:48,height:48,borderRadius:12,background:fmOpen?"rgba(5,150,105,0.15)":"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                <Calendar size={22} color={fmOpen?"#059669":"#94a3b8"}/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap" }}>
                  <span style={{ fontWeight:800,fontSize:18,color:fmOpen?"#0f172a":"#94a3b8" }}>Spotkania B2B — Fresh Market 2026</span>
                  {fmOpen
                    ? <span style={{ background:"#059669",color:"white",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20 }}>● AKTYWNE</span>
                    : <span style={{ background:"#f1f5f9",color:"#94a3b8",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20 }}>🔒 ZAMKNIĘTE</span>
                  }
                </div>
                <div style={{ fontSize:13,color:fmOpen?"#334155":"#94a3b8",lineHeight:1.8,maxWidth:580 }}>
                  Planowanie spotkań B2B z kupcami sieci handlowych podczas Fresh Market 2026.<br/>
                  {fmOpen
                    ? <><strong style={{ color:"#059669" }}>Aplikacja jest aktywna.</strong> Przejdź do sekcji Spotkania FM 2026, aby wybrać sieci i zobaczyć swój plan.</>
                    : <>Aplikacja będzie dostępna od września 2026.<br/>Planowane otwarcie: <strong>1 września 2026</strong>. Dostępna dla dostawców i kupców od 1 września.</>
                  }
                </div>
              </div>
            </div>
            {!fmOpen&&(
              <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:20 }}>
                {[["🎯","1–16 września","Wybór preferowanych sieci handlowych"],["🔒","16 września","Zamknięcie wyborów — dalsze zmiany tylko przez administratora"],["⚙️","17–22 września","Algorytm matchingu + ręczne korekty administratora"],["📋","22 września","Publikacja finalnego harmonogramu i numerów"],["🎪","24 września","Fresh Market 2026 — event"]].map(([ic,d,sub])=>(
                  <div key={d} style={{ flex:1,minWidth:120,padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}>
                    <div style={{ fontSize:16,marginBottom:3 }}>{ic}</div>
                    <div style={{ fontSize:11,fontWeight:700,color:"#334155" }}>{d}</div>
                    <div style={{ fontSize:11,color:"#94a3b8",marginTop:2,lineHeight:1.4 }}>{sub}</div>
                  </div>
                ))}
              </div>
            )}
            {fmOpen&&(
              <button onClick={()=>nav(resolveFMRoute(fmSettings))} style={{ padding:"13px 22px",background:"#059669",border:"none",borderRadius:10,color:"white",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,marginBottom:16 }}>
                <Calendar size={15}/> Przejdź do Spotkań FM 2026
              </button>
            )}
            <div style={{ paddingTop:14,borderTop:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8" }}>
              Pytania? Kontakt: <strong>Oksana Kozłowska</strong> · oksana@freshmarket.eu · +48 603 811 818
            </div>
          </div>
        );

        return fmOpen ? <>{fmTile}{preConnectTile}</> : <>{preConnectTile}{fmTile}</>;
      })()}
    </div>
  );
}


/* ── Wysyłki: unified hub (replaces Retail Chains + Preconnect + Send) ──── */
function PageWysylki({ sends, offers, pkgUsed, pkgMax, rem, wallet, sendToChain, nav, sid, accountId, co, retailers, companies }) {
  function getRetailerLive(id) {
    return (retailers||[]).find(r=>r.id===id) || null;
  }
  const mySends = (sends||[]).filter(s=>!s.supplierId||s.supplierId===accountId);
  const [view, setView] = useState(sid ? "new" : "sieci");  // "sieci" | "new" | "list"
  const [tab,  setTab]  = useState("all");
  const [so,   setSo]   = useState(sid ? String(sid) : "");
  const [sr,   setSr]   = useState("");
  const [search, setSearch] = useState("");

  const ao = offers.filter(o => o.status==="active" && (!o.supplierId || o.supplierId===accountId));
  const pct = Math.min(100, Math.round(pkgUsed / pkgMax * 100));

  // [B2B Round prod-rollout / UX] Modal potwierdzenia kosztu — supplier widzi
  // "Pobierzemy 1 wysyłkę. Zostanie X/Y" przed faktyczną wysyłką. Buduje
  // zaufanie i eliminuje przypadkowe kliknięcia. Codex feedback P0.
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  function doSend() {
    if (!so || !sr) return;
    setShowSendConfirm(true);
  }

  function confirmAndSend() {
    sendToChain(+so, +sr);
    setShowSendConfirm(false);
    setView("list"); setSo(""); setSr(""); setTab("pending");
  }

  function startSendTo(retailerId) {
    setSr(String(retailerId));
    setView("new");
  }

  const filtered = mySends.filter(s => {
    if (tab === "sent")    return ["sent","read","read_manual"].includes(s.status);
    if (tab === "pending") return ["pending_moderation","approved","queued"].includes(s.status);
    if (tab === "expired") return s.status === "unread_expired";
    return true;
  });

  const filteredRetailers = (retailers||[]).filter(r => {
    if(r.active === false) return false;
    if(search === "") return true;
    return r.name.toLowerCase().includes(search.toLowerCase()) ||
      (CNAMES[r.country]||"").toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div>
      {/* Top nav: 3 views */}
      <div style={{ display:"flex",gap:0,marginBottom:20,background:"#f1f5f9",borderRadius:10,padding:4,width:"fit-content" }}>
        {[["sieci","Sieci handlowe"],["list",`Historia (${mySends.length})`]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} disabled={v==="new"&&rem<=0} style={{ padding:"8px 18px",borderRadius:8,border:"none",background:view===v?"white":"transparent",fontWeight:view===v?600:400,fontSize:13,cursor:(v==="new"&&rem<=0)?"not-allowed":"pointer",fontFamily:"inherit",color:view===v?"#1e293b":"#64748b",boxShadow:view===v?"0 1px 4px rgba(0,0,0,0.08)":"none",whiteSpace:"nowrap",opacity:(v==="new"&&rem<=0)?0.45:1 }}>{l}</button>
        ))}
      </div>

      {/* Package status bar — always visible */}
      <div style={{ display:"flex",gap:10,alignItems:"center",padding:"10px 16px",background:"linear-gradient(90deg,#0f172a,#1e3a5f)",borderRadius:10,marginBottom:18,flexWrap:"wrap" }}>
        <div style={{ flex:1,minWidth:160 }}>
          <div style={{ fontSize:11,color:"rgba(255,255,255,0.45)",marginBottom:3 }}>{getPlanLabel(co?.pkg)||getPlanLabel(COMPANY_INIT.pkg)||"Standard 10 wysyłek"}</div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ flex:1,background:"rgba(255,255,255,0.12)",borderRadius:3,height:6,overflow:"hidden",maxWidth:180 }}>
              <div style={{ height:"100%",borderRadius:3,width:`${pct}%`,background:pct>=90?"#f59e0b":"#0d9488" }}/>
            </div>
            <span style={{ fontSize:12,color:"rgba(255,255,255,0.6)" }}>{pkgUsed}/{pkgMax} wysyłek</span>
          </div>
        </div>
        {wallet.balance > 0 && <div style={{ fontSize:12,color:"rgba(255,255,255,0.55)",display:"flex",gap:5,alignItems:"center" }}><Wallet size={12}/>Portfel: {wallet.balance} EUR</div>}
        {rem <= 0
          ? <span style={{ fontSize:11,background:"rgba(239,68,68,0.2)",color:"#fca5a5",padding:"3px 10px",borderRadius:8 }}>Brak wysyłek – dokup pakiet</span>
          : null}
      </div>

      {/* ── VIEW: SIECI HANDLOWE ── */}
      {view === "sieci" && (
        <div>
          <div style={{ display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap" }}>
            <h3 style={{ margin:0,fontSize:15 }}>Sieci handlowe ({(retailers||[]).length})</h3>
            <div style={{ display:"flex",gap:8,marginLeft:"auto",alignItems:"center" }}>
              <span style={{ fontSize:12,color:"#64748b",background:"#f8fafc",padding:"5px 12px",borderRadius:8,border:"1px solid #e2e8f0" }}>
                {sends.filter(s=>["sent","read","read_manual"].includes(s.status)).length} wysłanych · {sends.filter(s=>["read","read_manual"].includes(s.status)).length} przeczytanych
              </span>
              <input
                value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Szukaj sieci..."
                style={{ padding:"7px 14px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",width:180 }}
              />
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12 }}>
            {filteredRetailers.map(r => {
              const rSends = sends.filter(s => s.retailerId === r.id && !["queued","pending_moderation","rejected"].includes(s.status));
              const rRead  = rSends.filter(s => ["read","read_manual"].includes(s.status)).length;
              const hasSent = rSends.length > 0;
              return (
                <div key={r.id} style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,padding:16,display:"flex",flexDirection:"column",gap:10 }}>
                  {/* Header */}
                  <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                    <RetailerLogo retailer={r} size={40}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700,fontSize:14 }}>{r.name}</div>
                      <div style={{ fontSize:12,color:"#64748b" }}>{FLAGS[r.country]||"🌐"} {CNAMES[r.country]||r.country}</div>
                    </div>
                    {hasSent && <Badge color="#0d9488" bg="rgba(13,148,136,0.08)">{rSends.length} wysł.</Badge>}
                  </div>
                  {/* Categories */}
                  <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
                    {getRetailerCats(r).map(c=><Badge key={c} color="#475569">{CEMOJI[c]} {c}</Badge>)}
                  </div>
                  {/* Buyer info - NO personal data shown to supplier */}
                  <div style={{ padding:"8px 10px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0",fontSize:12 }}>
                    <div style={{ display:"flex",gap:14,color:"#64748b",alignItems:"center" }}>
                      <span style={{ display:"flex",gap:4,alignItems:"center" }}><Calendar size={10}/> Mailing: {r.nextSend}</span>
                      <span style={{ display:"flex",gap:4,alignItems:"center" }}><Users size={10}/> Kupiec kategorii: {getRetailerCats(r).join(", ")}</span>
                    </div>
                    {hasSent && <div style={{ marginTop:4,color:"#059669" }}>{rRead}/{rSends.length} propozycji przeczytanych</div>}
                  </div>
                  {/* Action */}
                  <Btn
                    primary full
                    onClick={() => startSendTo(r.id)}
                    disabled={rem <= 0}
                    style={{ marginTop:2 }}
                  >
                    <Send size={13}/> Wyślij propozycję do {r.name}
                  </Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── VIEW: NEW SEND FORM ── */}
      {view === "new" && (
        <div style={{ maxWidth:600 }}>
          <Card title="Wyślij propozycję do sieci" icon={Send} actions={<Btn sm outline onClick={()=>setView("sieci")}><X size={11}/> Anuluj</Btn>}>
            <div style={{ display:"flex",gap:8,padding:"10px 14px",background:"#f0fdf4",borderRadius:8,marginBottom:16,fontSize:12,color:"#047857",border:"1px solid #bbf7d0" }}>
              <ShieldCheck size={14} color="#059669" style={{ flexShrink:0,marginTop:1 }}/>
              <div>Gwarancja 14 dni — jeśli kupiec nie otworzy propozycji, środki wracają automatycznie na portfel.</div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
              <Inp label="Propozycja" required value={so} onChange={e=>setSo(e.target.value)}>
                <option value="">— wybierz —</option>
                {ao.map(o=>{
                  const priv=getInternalOfferTitle(o); const pub=getPublicOfferTitle(o);
                  const lbl=priv&&priv!==pub?`🔒 ${priv}  |  🌐 ${pub}`:`${CEMOJI[o.category]||""} ${pub}`;
                  return <option key={o.id} value={o.id}>{lbl}</option>;
                })}
              </Inp>
              {ao.length===0&&<Alrt type="warning">Brak aktywnych propozycji. <button onClick={()=>nav("offer-create")} style={{ background:"none",border:"none",cursor:"pointer",color:"#d97706",fontWeight:700,fontSize:12,padding:0 }}>Dodaj propozycję →</button></Alrt>}
              <Inp label="Sieć handlowa" required value={sr} onChange={e=>setSr(e.target.value)}>
                <option value="">— wybierz —</option>
                {(retailers||[]).filter(r=>r.active!==false).map(r=><option key={r.id} value={r.id}>{FLAGS[r.country]||"🌐"} {r.name}</option>)}
              </Inp>
            </div>
            {so && sr && (()=>{
              const o = ao.find(x=>x.id===+so);
              const r = (retailers||[]).find(x=>x.id===+sr);
              return (
                <div style={{ display:"flex",gap:12,padding:12,background:"#f8fafc",borderRadius:8,marginBottom:14,fontSize:12,border:"1px solid #e2e8f0" }}>
                  <div style={{ flex:1 }}>
                    {getInternalOfferTitle(o)&&<div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:2 }}><span style={{ fontSize:10,fontWeight:700,color:"#64748b" }}>🔒 Własny:</span><strong style={{ fontSize:12 }}>{getInternalOfferTitle(o)}</strong></div>}
                    <div style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ fontSize:10,fontWeight:700,color:"#0d9488" }}>🌐 Dla kupca:</span><span style={{ fontSize:12 }}>{getPublicOfferTitle(o)}</span></div>
                    <div style={{ color:"#64748b",marginTop:3,fontSize:11 }}>{o?.volume} {o?.volumeUnit} · {FLAGS[o?.origin]||"🌐"}</div>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}><RetailerLogo retailer={r} size={28}/><div><div style={{ fontWeight:600 }}>{r?.name}</div><div style={{ color:"#64748b" }}>Wysyłka: {r?.nextSend}</div></div></div>
                </div>
              );
            })()}
            <div style={{ display:"flex",gap:10,alignItems:"center",justifyContent:"space-between" }}>
              <Btn primary onClick={doSend} disabled={!so||!sr}>
                <Send size={13}/> Wyślij propozycję
              </Btn>
              <span style={{ fontSize:12,color:"#94a3b8" }}>Koszt: {getPlanById(co?.pkg)?.perSend||40} EUR · 1 wysyłka z pakietu</span>
            </div>
          </Card>
        </div>
      )}

      {/* ── VIEW: HISTORY LIST ── */}
      {view === "list" && (
        <div>
          {/* Filter tabs */}
          <div style={{ display:"flex",gap:0,marginBottom:12,background:"white",border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",width:"fit-content" }}>
            {[["all","Wszystkie",sends.length],["sent","Wysłane",sends.filter(s=>["sent","read","read_manual"].includes(s.status)).length],["pending","Kolejka",sends.filter(s=>["pending_moderation","approved","queued"].includes(s.status)).length],["expired","Wygasłe",sends.filter(s=>s.status==="unread_expired").length]].map(([k,l,n])=>(
              <div key={k} onClick={()=>setTab(k)} style={{ display:"flex",gap:6,alignItems:"center",padding:"9px 14px",cursor:"pointer",background:tab===k?"#f0fdfa":"white",borderRight:"1px solid #f1f5f9",borderBottom:tab===k?"2px solid #0d9488":"2px solid transparent" }}>
                <span style={{ fontSize:13,fontWeight:tab===k?600:400,color:tab===k?"#0d9488":"#475569" }}>{l}</span>
                <span style={{ fontSize:11,background:tab===k?"rgba(13,148,136,0.12)":"#f1f5f9",color:tab===k?"#0d9488":"#64748b",padding:"1px 7px",borderRadius:10,fontWeight:600 }}>{n}</span>
              </div>
            ))}
          </div>
          {filtered.length===0 && (
            <div style={{ padding:40,textAlign:"center",color:"#94a3b8",background:"white",borderRadius:12,border:"1px solid #e2e8f0" }}>
              <Send size={28} style={{ marginBottom:8,opacity:0.25,display:"block",margin:"0 auto 10px" }}/>
              <div style={{ fontWeight:600,marginBottom:4 }}>Brak wysyłek w tej kategorii</div>
              {tab==="all"&&<div style={{ fontSize:12,marginTop:6 }}><button onClick={()=>setView("sieci")} style={{ background:"none",border:"none",cursor:"pointer",color:"#0d9488",fontWeight:600,fontSize:12,padding:0 }}>Wyślij pierwszą propozycję →</button></div>}
            </div>
          )}
          {filtered.map(s => {
            const o = getOffer(s.offerId, []); const r = getRetailerLive(s.retailerId);
            const sc = STATUS_MAP[s.status];
            const isRead = ["read","read_manual"].includes(s.status);
            const isExpired = s.status === "unread_expired";
            return (
              <div key={s.id} style={{ display:"flex",gap:12,padding:"12px 16px",background:"white",borderRadius:10,border:`1px solid ${isExpired?"#fca5a5":isRead?"#bbf7d0":"#e2e8f0"}`,marginBottom:8,alignItems:"center" }}>
                <span style={{ fontSize:19 }}>{CEMOJI[o?.category]}</span>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:600,fontSize:13,marginBottom:2 }}>{o?.title||o?.product}</div>
                  <div style={{ fontSize:12,color:"#64748b",display:"flex",gap:8,alignItems:"center" }}>
                    <RetailerLogo retailer={r} size={14}/>
                    <span>{r?.name}</span>
                    <span>·</span>
                    <span>{s.sentAt||s.sendDate}</span>
                  </div>
                </div>
                <span title={STATUS_TIPS[s.status]||""} style={{cursor:"help",display:"inline-flex",alignItems:"center",gap:2}}>
                    <Badge color={sc?.[1]}>{sc?.[0]}</Badge>
                    {(s.status==="pending_moderation"||s.status==="queued")&&<Info size={11} color={sc?.[1]} style={{verticalAlign:"middle"}}/>}
                  </span>
                {s.sentAt && !isRead && !isExpired && s.daysLeft > 0 && (
                  <span style={{ fontSize:11,color:"#d97706",background:"#fffbeb",padding:"2px 8px",borderRadius:6,border:"1px solid #fde68a" }}>{s.daysLeft}d</span>
                )}
                {isExpired && (
                  <span style={{ fontSize:11,color:"#059669",background:"#d1fae5",padding:"2px 8px",borderRadius:6,fontWeight:600 }}>+{getPlanById(co?.pkg)?.perSend||40}€</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* [B2B Round prod-rollout / UX] Send-cost confirmation modal — Codex P0.
          Pokazuje supplerowi DOKŁADNIE co się stanie po kliknięciu Wyślij:
          ile wysyłek zostanie pobranych z pakietu, ile pozostanie, ile to
          kosztuje per send. Bez ukrytych kosztów. */}
      {showSendConfirm && (() => {
        const selectedOffer = offers.find(o => o.id === +so);
        const selectedRetailer = (retailers || []).find(r => r.id === +sr);
        const perSendCost = getPlanById(co?.pkg)?.perSend || 40;
        const remainingAfter = Math.max(0, (rem || 0) - 1);
        return (
          <div style={{ position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={()=>setShowSendConfirm(false)}>
            <div style={{ background:"white",borderRadius:14,padding:28,maxWidth:460,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e)=>e.stopPropagation()}>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
                <div style={{ width:40,height:40,borderRadius:10,background:"#0d9488",display:"flex",alignItems:"center",justifyContent:"center" }}>
                  <Send size={18} color="white"/>
                </div>
                <div>
                  <div style={{ fontWeight:700,fontSize:16,color:"#0f172a" }}>Potwierdź wysyłkę</div>
                  <div style={{ fontSize:12,color:"#64748b" }}>Zaraz pobierzemy 1 wysyłkę z pakietu</div>
                </div>
              </div>

              <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 16px",marginBottom:16 }}>
                <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13 }}>
                  <span style={{ color:"#64748b" }}>Propozycja</span>
                  <strong style={{ color:"#1e293b",textAlign:"right" }}>{selectedOffer?.title || selectedOffer?.product || `#${so}`}</strong>
                </div>
                <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderTop:"1px solid #e2e8f0" }}>
                  <span style={{ color:"#64748b" }}>Sieć handlowa</span>
                  <strong style={{ color:"#1e293b",textAlign:"right" }}>{selectedRetailer?.name || `#${sr}`}</strong>
                </div>
                <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderTop:"1px solid #e2e8f0" }}>
                  <span style={{ color:"#64748b" }}>Koszt wysyłki</span>
                  <strong style={{ color:"#1e293b" }}>1 wysyłka ({perSendCost} EUR)</strong>
                </div>
                <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderTop:"1px solid #e2e8f0" }}>
                  <span style={{ color:"#64748b" }}>Po wysyłce zostanie</span>
                  <strong style={{ color: remainingAfter<=1 ? "#d97706" : "#059669" }}>{remainingAfter}/{pkgMax} wysyłek</strong>
                </div>
              </div>

              <div style={{ fontSize:12,color:"#64748b",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 12px",marginBottom:18,lineHeight:1.5 }}>
                <strong style={{ color:"#065f46" }}>⭐ Złota zasada 14 dni:</strong> jeśli kupiec nie otworzy propozycji w ciągu 14 dni, kredyt automatycznie wraca na Twój portfel.
              </div>

              <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
                <button onClick={()=>setShowSendConfirm(false)} style={{ padding:"10px 18px",background:"white",color:"#475569",border:"1px solid #cbd5e1",borderRadius:8,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>
                  Anuluj
                </button>
                <button onClick={confirmAndSend} style={{ padding:"10px 18px",background:"#0d9488",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",gap:6,alignItems:"center" }}>
                  <Send size={13}/> Wyślij propozycję
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Company ─────────────────────────────────────────────────────────────
   [B2B Round adaptive-company-profile-ai]
   Profil rozłożony na sekcje. Mała firma uzupełnia podstawy + jeden opis;
   większa wypełnia rynki/zaplecze/materiały i AI generuje bogatszy profil.
   Pola strukturalne idą do `c.profile_data` (jsonb). Dwa opisy AI
   (description_short + description) są na top-level i można je edytować
   ręcznie po wygenerowaniu.
*/
const CUSTOMER_TYPE_OPTIONS = [
  ["retail", "Retail"],
  ["wholesale", "Hurt"],
  ["horeca", "HoReCa"],
  ["processing", "Przetwórstwo"],
  ["export", "Eksport"],
];
const PARTNERSHIP_OPTIONS = [
  ["programy_stale", "Programy stałe"],
  ["spot", "Spot"],
  ["promocje", "Promocje"],
  ["sezonowe_akcje", "Sezonowe akcje"],
];
const CAPABILITY_OPTIONS = [
  ["sortownia", "Sortownia"],
  ["pakowalnia", "Pakowalnia"],
  ["chlodnia", "Chłodnia"],
  ["linia_optyczna", "Linia optyczna"],
  ["etykietowanie", "Etykietowanie"],
  ["konfekcjonowanie", "Konfekcjonowanie"],
  ["retail_ready", "Przygotowanie pod retail"],
  ["wlasna_logistyka", "Własna logistyka"],
  ["partner_logistyczny", "Partner logistyczny"],
];
const EMPLOYEES_OPTIONS = [
  ["", "—"],
  ["1-10", "1–10"],
  ["11-50", "11–50"],
  ["51-200", "51–200"],
  ["201-500", "201–500"],
  ["500+", "500+"],
];

// Czy URL prowadzi do PDF-a (nie obrazka). Używane przy renderowaniu
// listy materiałów — PDF dostaje ikonę pliku, obrazek thumbnail.
function materialIsPdf(url) {
  if (!url) return false;
  return /\.pdf(\?|$)/i.test(url);
}

function PageCompany({ co, companyId, setCo, fl, aiModal, setAiModal, aiLoad, runAI, offers }) {
  const [c,setC]=useState({...co, contacts:Array.isArray(co.contacts)?co.contacts:[]}); const [showPreview,setShowPreview]=useState(false); const [saving,setSaving]=useState(false);
  const u = (k, v) => setC(prev => ({ ...prev, [k]: v }));
  // Pomocnik do edycji zagnieżdżonych pól w profile_data.
  // setPd("offer", "private_label", true) -> {profile_data: {offer: {private_label: true}}}
  const setPd = (section, key, val) => setC(prev => ({
    ...prev,
    profile_data: {
      ...(prev.profile_data || {}),
      [section]: { ...((prev.profile_data || {})[section] || {}), [key]: val },
    },
  }));
  const setPdRoot = (key, val) => setC(prev => ({
    ...prev,
    profile_data: { ...(prev.profile_data || {}), [key]: val },
  }));
  const pd = c.profile_data || {};
  const basics = pd.basics || {};
  const offer = pd.offer || {};
  const trade = pd.trade || {};
  const ops = pd.operations || {};
  const materials = Array.isArray(pd.materials) ? pd.materials : [];
  const supplierPitch = typeof pd.supplier_pitch === "string" ? pd.supplier_pitch : "";

  const contactRoles = [["sales","Handlowy"],["quality","Jakościowy"],["logistics","Logistyka"],["management","Zarząd"],["other","Inny"]];
  const normalizeContacts=(list=[]) => (Array.isArray(list)?list:[])
    .map((ct,i)=>({
      ...ct,
      role: ct.role || "sales",
      name: (ct.name || "").trim(),
      position: (ct.position || "").trim(),
      phone: (ct.phone || "").trim(),
      email: (ct.email || "").trim(),
      sort_order: i,
    }))
    .filter(ct=>ct.name || ct.position || ct.phone || ct.email);
  const contacts = Array.isArray(c.contacts) ? c.contacts : [];
  const calcCompleteness=(d)=>{
    let pts=0;
    if(d.logo) pts+=20;
    if(d.name) pts+=10;
    if(d.country) pts+=5;
    if(d.city) pts+=5;
    if(d.website) pts+=5;
    if(d.phone) pts+=5;
    if(d.description&&d.description.length>50) pts+=10;
    if(d.description_short&&d.description_short.length>20) pts+=5;
    if((d.types||[]).length>0) pts+=8;
    if((d.categories||[]).length>0) pts+=8;
    if((d.contacts||[]).some(ct=>ct.phone)) pts+=8;
    if((d.certs||[]).length>0) pts+=4;
    // Bonus za rozszerzony profil — 7 punktów rozdzielonych na sekcje
    const dpd = d.profile_data || {};
    if (Array.isArray(dpd.trade?.export_countries) && dpd.trade.export_countries.length) pts+=2;
    if (Array.isArray(dpd.operations?.capabilities) && dpd.operations.capabilities.length) pts+=2;
    if (Array.isArray(dpd.materials) && dpd.materials.length) pts+=2;
    if (typeof dpd.supplier_pitch === "string" && dpd.supplier_pitch.trim()) pts+=1;
    return Math.min(100,pts);
  };


  // Helper: tekst CSV → array kodów krajów upper-case
  const parseCountryList = (txt) => (txt || "")
    .split(/[,;\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const exportCountriesText = Array.isArray(trade.export_countries)
    ? trade.export_countries.join(", ")
    : "";

  const completeness = calcCompleteness({...c, contacts:normalizeContacts(contacts)});
  const addContact=(role="sales")=>u("contacts",[...contacts,{ role, name:"", position:"", phone:"", email:"" }]);
  const updateContact=(i,patch)=>u("contacts",contacts.map((ct,idx)=>idx===i?{...ct,...patch}:ct));
  const removeContact=(i)=>u("contacts",contacts.filter((_,idx)=>idx!==i));
  const saveProfile=async()=>{
    if(!c.logo){fl("Wgraj logo firmy.","warning");return;}
    const nextContacts = normalizeContacts(contacts);
    const id = c.id || companyId;
    const next = {
      ...c,
      id:id||c.id,
      contacts:nextContacts,
      ai_review_status:"approved",
      completeness:calcCompleteness({...c, contacts:nextContacts}),
    };
    const companyPatch = {
      name: next.name,
      nip: next.nip || null,
      country: next.country || null,
      city: next.city || null,
      phone: next.phone || null,
      website: next.website || null,
      description: next.description || null,
      description_short: next.description_short || null,
      types: next.types || [],
      categories: next.categories || [],
      products: next.products || null,
      seasonality: next.seasonality || null,
      markets: next.markets || null,
      completeness: next.completeness || 0,
      logo: next.logo || null,
      profile_data: next.profile_data && typeof next.profile_data === "object" ? next.profile_data : {},
      ai_review_status: "approved",
    };
    setSaving(true);
    try {
      if (id) await dbUpdateCompany(id, companyPatch);
      const savedContacts = id ? await dbSaveCompanyContacts(id, nextContacts) : nextContacts;
      const savedProfile = {...next, contacts:savedContacts, completeness:calcCompleteness({...next, contacts:savedContacts})};
      setCo(savedProfile);
      fl("Profil zapisany.");
    } catch(e) {
      fl(`Nie udało się zapisać kontaktów: ${e?.message || e}`,"error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ maxWidth:840 }}>
      {showPreview&&<CompanyPreviewModal co={c} offers={offers} role="supplier" onClose={()=>setShowPreview(false)}/>}
      {/* AI banner */}
      <div style={{ background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start" }}>
        <Bot size={18} color="#3b82f6" style={{ flexShrink:0,marginTop:1 }}/>
        <div style={{ flex:1,fontSize:13,color:"#1e40af" }}>
          <strong>AI Auto-fill</strong> — AI wygeneruje krótki i standardowy opis firmy na podstawie Twoich danych, materiałów i strony WWW. Im więcej uzupełnisz pól poniżej (zaplecze, rynki, certyfikaty), tym bogatszy będzie profil.
        </div>
        <div style={{ display:"flex",gap:6 }}>
          <Btn sm onClick={()=>setAiModal(true)} style={{ background:"#3b82f6",color:"white",border:"none" }}><Sparkles size={12}/> Generuj AI</Btn>
          <Btn sm outline onClick={()=>setShowPreview(true)}><Eye size={12}/> Podgląd</Btn>
        </div>
      </div>
      {aiModal&&<div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center" }} onClick={()=>!aiLoad&&setAiModal(false)}><div onClick={e=>e.stopPropagation()} style={{ background:"white",borderRadius:14,padding:24,maxWidth:420,width:"90%" }}><h3 style={{ marginBottom:14 }}>AI Auto-fill</h3><div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>AI wykorzysta dane firmy z profilu, profil rozszerzony i treść Twojej strony, aby zaproponować dwa opisy: krótki (do podglądu) i standardowy (główny opis profilu).</div><Inp label="Strona WWW" value={c.website} onChange={e=>u("website",e.target.value)}/>{aiLoad&&<Alrt type="success"><RefreshCw size={13} style={{ animation:"spin 1s linear infinite" }}/> Analizuję stronę i przygotowuję opisy...</Alrt>}<div style={{ display:"flex",gap:8 }}><Btn primary onClick={()=>void runAI(c, patch => setC(prev=>({ ...prev, ...patch })))} disabled={aiLoad} full style={{ background:"#3b82f6" }}>Generuj</Btn><Btn outline onClick={()=>setAiModal(false)} disabled={aiLoad}>Anuluj</Btn></div></div></div>}
      {/* Completeness */}
      <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 16px",marginBottom:14 }}>
        <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4 }}><span>Kompletność profilu</span><span style={{ fontWeight:700,color:completeness>=80?"#059669":"#d97706" }}>{completeness}%</span></div>
        <div style={{ background:"#e2e8f0",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ height:"100%",background:completeness>=80?"#059669":"#d97706",borderRadius:3,width:`${completeness}%` }}/></div>
      </div>
      {/* Logo */}
      <Card title="Logo" icon={Award}>
        <div style={{ display:"flex",gap:14,alignItems:"flex-start" }}>
          <div style={{ width:76,height:76,borderRadius:10,border:`2px dashed ${c.logo?"#0d9488":"#dc2626"}`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:c.logo?"white":"#fef2f2" }}>{c.logo?<img src={c.logo} alt="" style={{ width:"100%",height:"100%",objectFit:"contain" }}/>:<Building2 size={24} color="#dc2626"/>}</div>
          <div style={{ flex:1 }}>
            <SimplePhotoUploader
              bucket="company-logos"
              pathPrefix={c.id || ""}
              value={c.logo || null}
              onChange={(newUrl) => u("logo", newUrl)}
              multi={false}
              label={c.logo ? "Kliknij aby zmienić logo" : "Kliknij aby wgrać logo firmy"}
            />
            {!c.logo && <div style={{ fontSize:11,color:"#dc2626",marginTop:6 }}>Wymagane do publikacji</div>}
          </div>
        </div>
      </Card>
      <Card title="Dane podstawowe" icon={Building2}>
        <Row><Inp label="Nazwa firmy" required value={c.name} onChange={e=>u("name",e.target.value)}/><Inp label="NIP/VAT" value={c.nip} onChange={e=>u("nip",e.target.value)}/></Row>
        <Row><Inp label="Kraj" value={c.country} onChange={e=>u("country",e.target.value)}><option value="">—</option>{CNAMES_SORTED.map(([k,v])=><option key={k} value={k}>{FLAGS[k]||"🌐"} {v}</option>)}</Inp><Inp label="Miasto" value={c.city} onChange={e=>u("city",e.target.value)}/></Row>
        <Row><Inp label="Strona WWW" value={c.website||""} onChange={e=>u("website",e.target.value)}/><Inp label="Telefon" value={c.phone||""} onChange={e=>u("phone",e.target.value)}/></Row>
      </Card>
      {/* Opisy AI — dwa warstwy: krótki (podgląd) + standardowy (główny) */}
      <Card title="Opis firmy" icon={Bot} actions={
        true
          ? <span style={{ fontSize:11,color:"#059669",background:"#d1fae5",padding:"3px 8px",borderRadius:4,fontWeight:600 }}>Gotowy do wyświetlenia</span>
          : c.ai_review_status === "edited"
          ? <span style={{ fontSize:11,color:"#0d9488",background:"#ccfbf1",padding:"3px 8px",borderRadius:4,fontWeight:600 }}>Edytowany</span>
          : <span style={{ fontSize:11,color:"#92400e",background:"#fef3c7",padding:"3px 8px",borderRadius:4,fontWeight:600 }}>Czeka na review</span>
      }>
        <Inp
          label="Opis krótki (2–3 zdania, ~200–300 znaków)"
          ta
          value={c.description_short || ""}
          onChange={e=>setC(prev=>({ ...prev, description_short:e.target.value, ai_review_status:"edited" }))}
          style={{ minHeight: 56 }}
          hint="Pokazywany w karcie firmy u kupca i w podglądzie. Nie powtarzaj nazwy firmy — kupiec już ją widzi."
        />
        <Inp
          label="Opis standardowy (4–6 zdań, ~450–700 znaków)"
          ta
          value={c.description || ""}
          onChange={e=>setC(prev=>({ ...prev, description:e.target.value, ai_review_status:"edited" }))}
          hint="Główny opis profilu. Generowany przez AI z Twoich danych — możesz go ręcznie poprawić."
        />
      </Card>
      <Card title="Typ firmy i kategorie" icon={Leaf}>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Typ firmy <span style={{ color:"#94a3b8",fontWeight:400 }}>(widoczne dla kupców)</span></label>
          <TagToggle items={[["producent","Producent"],["eksporter","Eksporter"],["importer","Importer"],["firma_handlowa","Firma Handlowa"],["pakowalnia","Pakowalnia"],["firma_logistyczna","Firma Logistyczna"],["kooperatywa","Kooperatywa"],["agent","Agent/Broker"]]} active={c.types} onChange={v=>u("types",v)}/>
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Kategorie produktowe</label>
          <TagToggle items={[["owoce","Owoce"],["warzywa","Warzywa"],["kwiaty","Kwiaty"],["zioła","Zioła"],["inne","Inne"]]} active={c.categories} onChange={v=>u("categories",v)}/>
        </div>
        <Row><Inp label="Produkty" value={c.products||""} onChange={e=>u("products",e.target.value)}/><Inp label="Rynki sprzedaży" value={c.markets||""} onChange={e=>u("markets",e.target.value)}/></Row>
      </Card>
      {/* Profil rozszerzony — sekcje opcjonalne, każda dodaje sygnał dla AI */}
      <Card title="Profil rozszerzony — podstawy" icon={Building2}>
        <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>Pola opcjonalne. Im więcej wypełnisz, tym bogatszy profil dla kupca.</div>
        <Row>
          <Inp
            label="Rok założenia"
            type="number"
            value={basics.founded_year || ""}
            onChange={e=>setPd("basics", "founded_year", e.target.value ? parseInt(e.target.value, 10) : null)}
          />
          <Inp
            label="Liczba pracowników"
            value={basics.employees || ""}
            onChange={e=>setPd("basics", "employees", e.target.value || null)}
          >
            {EMPLOYEES_OPTIONS.map(([k,v])=>(<option key={k} value={k}>{v}</option>))}
          </Inp>
        </Row>
      </Card>
      <Card title="Profil rozszerzony — oferta" icon={Tag}>
        <Row>
          <Inp label="Produkty całoroczne" value={offer.products_year_round || ""} onChange={e=>setPd("offer","products_year_round",e.target.value||null)} hint="np. jabłka, gruszki, kapusta"/>
          <Inp label="Produkty sezonowe" value={offer.products_seasonal || ""} onChange={e=>setPd("offer","products_seasonal",e.target.value||null)} hint="np. truskawki (V–VII), wiśnie (VI–VII)"/>
        </Row>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Typ obsługiwanych klientów</label>
          <TagToggle items={CUSTOMER_TYPE_OPTIONS} active={offer.customer_types || []} onChange={v=>setPd("offer","customer_types",v)}/>
        </div>
        <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer" }}>
          <input type="checkbox" checked={!!offer.private_label} onChange={e=>setPd("offer","private_label",e.target.checked)} />
          <span>Oferujemy markę własną / private label</span>
        </label>
      </Card>
      <Card title="Profil rozszerzony — handel i rynki" icon={Send}>
        <Inp
          label="Kraje eksportu (kody ISO oddzielone przecinkami)"
          value={exportCountriesText}
          onChange={e=>setPd("trade","export_countries", parseCountryList(e.target.value))}
          hint="np. DE, CZ, SK, FR, NL"
        />
        <Inp label="Główne rynki (opisowo)" value={trade.main_markets || ""} onChange={e=>setPd("trade","main_markets",e.target.value||null)} hint="np. EU Środkowa, kraje DACH, rynek krajowy"/>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Typ współpracy</label>
          <TagToggle items={PARTNERSHIP_OPTIONS} active={trade.partnership_types || []} onChange={v=>setPd("trade","partnership_types",v)}/>
        </div>
        <Inp label="Typowe wolumeny" value={trade.typical_volumes || ""} onChange={e=>setPd("trade","typical_volumes",e.target.value||null)} hint="np. 10–50 ton tygodniowo, 1–2 TIR-y dziennie"/>
      </Card>
      <Card title="Profil rozszerzony — zaplecze operacyjne" icon={ShieldCheck}>
        <div style={{ fontSize:12,color:"#64748b",marginBottom:8 }}>Zaznacz, czym dysponujesz lub co jesteś w stanie zaoferować.</div>
        <TagToggle items={CAPABILITY_OPTIONS} active={ops.capabilities || []} onChange={v=>setPd("operations","capabilities",v)}/>
      </Card>
      <Card title="Materiały (PDF, katalogi, zdjęcia)" icon={Award}>
        <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>Wgraj katalog handlowy, broszurę, zdjęcia zakładu / pakowania / produktów. Kupiec zobaczy je w podglądzie profilu.</div>
        <SimplePhotoUploader
          bucket="company-materials"
          pathPrefix={c.id || ""}
          value={materials}
          onChange={(newList) => setPdRoot("materials", newList)}
          multi={true}
          max={12}
          accept="image/*,application/pdf"
          label="Kliknij lub przeciągnij PDF / zdjęcie"
        />
        {materials.length > 0 && (
          <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginTop:10 }}>
            {materials.filter(materialIsPdf).map(url => (
              <a key={url} href={url} target="_blank" rel="noreferrer" style={{ fontSize:11,color:"#3b82f6",background:"#eff6ff",padding:"3px 8px",borderRadius:6,textDecoration:"none",border:"1px solid #bfdbfe" }}>
                📄 PDF
              </a>
            ))}
          </div>
        )}
      </Card>
      <Card title="Co chcesz podkreślić kupcowi?" icon={Sparkles}>
        <Inp
          ta
          value={supplierPitch}
          onChange={e=>setPdRoot("supplier_pitch", e.target.value)}
          hint="Wolny tekst — AI uwzględni jako sygnał Twoich priorytetów handlowych. Nie skopiuje dosłownie."
          style={{ minHeight: 80 }}
        />
      </Card>
      {(c.certs||[]).length>0&&<Card title="Certyfikaty" icon={ShieldCheck}>{c.certs.map((ct,i)=><div key={i} style={{ display:"flex",gap:10,padding:"8px 12px",background:"#f0fdf4",borderRadius:7,marginBottom:6,fontSize:13,border:"1px solid #bbf7d0" }}><ShieldCheck size={13} color="#059669"/><strong style={{ color:"#0d9488" }}>{ct.type}</strong><span style={{ color:"#64748b" }}>Nr: {ct.number}</span><span style={{ marginLeft:"auto",color:"#059669" }}>do {ct.valid}</span></div>)}</Card>}
      <Card title="Kontakty" icon={Users} actions={<Btn sm outline onClick={()=>addContact()}><Plus size={12}/> Dodaj kontakt</Btn>}>
        {contacts.length===0 ? (
          <div style={{ padding:"14px 16px",background:"#f8fafc",border:"1px dashed #cbd5e1",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12 }}>
            <div style={{ fontSize:13,color:"#64748b" }}>Dodaj osobę kontaktową widoczną dla kupców.</div>
            <Btn sm primary onClick={()=>addContact()}><Plus size={12}/> Dodaj pierwszy kontakt</Btn>
          </div>
        ) : (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:12 }}>
            {contacts.map((ct,i)=>(
              <div key={ct.id||i} style={{ padding:12,background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}>
                <div style={{ display:"flex",alignItems:"flex-start",gap:8 }}>
                  <Inp label="Rola" value={ct.role||"sales"} onChange={e=>updateContact(i,{role:e.target.value})} style={{ minWidth:0 }}>
                    {contactRoles.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                  </Inp>
                  <button type="button" title="Usuń kontakt" onClick={()=>removeContact(i)} style={{ marginTop:23,width:32,height:32,borderRadius:8,border:"1px solid #fecaca",background:"#fff",color:"#dc2626",display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
                    <X size={14}/>
                  </button>
                </div>
                <Inp label="Imię i nazwisko" value={ct.name||""} onChange={e=>updateContact(i,{name:e.target.value})}/>
                <Inp label="Stanowisko" value={ct.position||""} onChange={e=>updateContact(i,{position:e.target.value})}/>
                <Inp label="Telefon" value={ct.phone||""} onChange={e=>updateContact(i,{phone:e.target.value})}/>
                <Inp label="Email" value={ct.email||""} onChange={e=>updateContact(i,{email:e.target.value})}/>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginBottom:24 }}>
        <Btn outline onClick={()=>setShowPreview(true)}><Eye size={13}/> Podgląd kupca</Btn>
        <Btn primary disabled={saving} onClick={()=>void saveProfile()}>{saving?"Zapisywanie...":"Zapisz profil"}</Btn>
      </div>
    </div>
  );
}

/* ── Offers ────────────────────────────────────────────────────────────── */
function PageOffers({ offers, sends, nav, accountId }) {
  const myOffers = (offers||[]).filter(o=>!o.supplierId||o.supplierId===accountId);
  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#0d9488",marginBottom:4 }}>PreConnect</div>
        <div style={{ fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:-0.3 }}>Moje propozycje asortymentowe</div>
        <div style={{ fontSize:13,color:"#64748b",lineHeight:1.5,maxWidth:680,marginTop:4 }}>
          Lista Twoich propozycji produktowych. Każda pokazuje konkretne produkty kupcom — to nie jest klasyczne ofertowanie cenowe, więc <strong>cena jest opcjonalna</strong>.
        </div>
      </div>
      <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:14 }}>
        <Btn dark onClick={()=>nav("offer-create")}><Plus size={13}/> Dodaj propozycję asortymentową</Btn>
      </div>
      {myOffers.length===0&&<Alrt>Brak propozycji. Kliknij „Dodaj propozycję asortymentową" aby dodać pierwszą.</Alrt>}
      {myOffers.map(o=>{ const sc=sends.filter(s=>s.offerId===o.id); const rc=sc.filter(s=>["read","read_manual"].includes(s.status)).length; const priv=getInternalOfferTitle(o); const pub=getPublicOfferTitle(o); return (
        <div key={o.id} style={{ display:"flex",gap:12,padding:"14px 16px",background:"white",borderRadius:10,border:"1px solid #e2e8f0",marginBottom:8,alignItems:"center" }}>
          <span style={{ fontSize:24 }}>{CEMOJI[o.category]}</span>
          <div style={{ flex:1,minWidth:0 }}>
            {priv && (
              <div style={{ display:"flex",gap:6,alignItems:"center",marginBottom:2 }}>
                <strong style={{ fontSize:13,color:"#1e293b" }}>{priv}</strong>
                <span style={{ fontSize:9,fontWeight:700,color:"#64748b",background:"#f1f5f9",padding:"1px 6px",borderRadius:4,letterSpacing:"0.03em",textTransform:"uppercase" }}>Tylko Ty</span>
              </div>
            )}
            <div style={{ display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap" }}>
              <span style={{ fontSize:priv?11:14,fontWeight:priv?400:700,color:priv?"#64748b":"#1e293b" }}>{pub}</span>
              {priv&&<span style={{ fontSize:9,fontWeight:700,color:"#0d9488",background:"rgba(13,148,136,0.08)",padding:"1px 6px",borderRadius:4,textTransform:"uppercase",letterSpacing:"0.03em" }}>Dla kupca</span>}
              <Badge color={o.status==="active"?"#16a34a":"#64748b"}>{o.status==="active"?"Opublikowana":"Szkic"}</Badge>
              {o.tier==="premium"&&<Badge color="#d97706" bg="#fef3c7">Premium</Badge>}
            </div>
            <div style={{ fontSize:12,color:"#64748b" }}>{FLAGS[o.origin]||"🌐"} {CNAMES[o.origin]||o.origin} · {o.volume} {o.volumeUnit}</div>
          </div>
          <div style={{ display:"flex",gap:14,flexShrink:0 }}>{[["Sieci",sc.length,"#3b82f6"],["Przecz.",rc,"#059669"]].map(([l,v,cl])=><div key={l} style={{ textAlign:"center" }}><div style={{ fontSize:15,fontWeight:700,color:cl }}>{v}</div><div style={{ fontSize:10,color:"#94a3b8" }}>{l}</div></div>)}</div>
          <div style={{ display:"flex",gap:5,flexShrink:0 }}>
            <Btn sm outline onClick={()=>nav("offer-edit",o.id)}><Edit size={11}/> Edytuj</Btn>
            <Btn sm outline onClick={()=>nav("offer-copy",o.id)} title="Duplikuj propozycję — przyspiesza dodawanie podobnych produktów" style={{ borderColor:"#7c3aed",color:"#7c3aed" }}><Layers size={11}/> Duplikuj</Btn>
            {o.status==="active"&&<Btn sm style={{ background:"rgba(13,148,136,0.08)",color:"#0d9488" }} onClick={()=>nav("wysylki",o.id)}><Send size={11}/> Wyślij</Btn>}
          </div>
        </div>
      );})}
    </div>
  );
}

/* ── Offer Form – 3 steps (Preconnect Offer Form) ───────────────────────── */
function PageOfferForm({ offer, saveOffer, nav, co }) {
  const [step,setStep]=useState(1);
  const [f,setF]=useState(offer||{
    // Step 1 – Identyfikacja produktu
    product:"", variety:"", category:"", subcategory:"", origin:"", region:"",
    offerType:"", positioning:"",
    // Step 1 – Specyfikacja jakościowa
    size:"", qualityClass:"", qualitySpec:"", brand:"", saleMode:"", isBio:false, brix:"", colorSpec:"",
    // Step 1 – Kwiaty (warunkowe)
    stemLength:"", openingPhase:"", bouquetCount:"", vaseLife:"", flowerColor:"",
    // Step 1 – Zdjęcia
    photos:[],
    // Step 2 – Dostępność i wolumen
    from:"", to:"", availabilityModel:"", volumeMin:"", volumeMax:"",
    volumeUnit:"kg", moq:"1 Paleta", leadTime:"", promoVolume:null, promoVolumePct:"", deliveryDays:[],
    // Step 2 – Opakowanie
    packaging:[], customPackaging:"", packagingDesc:"", netWeight:"", unitsPerCarton:"", ean:"",
    palletType:"", palletHeight:"", cartonsPerLayer:"", layersPerPallet:"", unitsPerPallet:"", srp:"",
    // Step 2 – Logistyka
    deliveryModel:"", loadingPoint:"", deliveryRegions:"", coldChain:"", tempTransport:"",
    // Step 2 – Certyfikaty
    traceability:"", certs:[], customCert:"", certNumber:"", certValid:"", currentTests:null,
    // Step 2 – Warunki handlowe
    currency:"EUR", priceOffer:"", priceUnit:"kg", incoterm:"", priceFrom:"", priceTo:"",
    promoPrice:null, contractProgram:null, samplesAvail:"",
    // Step 3 – Korzyści dla kupca
    benefit1:"", benefit2:"", benefit3:"", shopBenefit:"",
    // Step 3 – Ograniczenie ryzyka
    riskMitigation:"", riskProof:"", riskNow:"",
    // Step 3 – CTA
    cta:[],
    // Meta + backward compat
    title:"", status:"draft", tier:"standard",
    volume:"", volumeUnit2:"t/mies.", minOrder:"1 Paleta", description:""
  });
  const [showPrev,setShowPrev]=useState(false);
  const [errors,setErrors]=useState({});
  const photoRef=useRef();
  const u=(k,v)=>{ setF(p=>({...p,[k]:v})); setErrors(e=>({...e,[k]:false})); };
  const toggleArr=(key,val)=>setF(p=>({...p,[key]:(p[key]||[]).includes(val)?(p[key]||[]).filter(x=>x!==val):[...(p[key]||[]),val]}));

  const REQUIRED_1=["product","variety","category","origin","offerType","positioning","qualitySpec","saleMode"];
  const REQUIRED_2=["from","to","availabilityModel","volumeMin","volumeMax","volumeUnit","moq","leadTime","packagingDesc","deliveryModel","loadingPoint","deliveryRegions","coldChain","traceability"];
  const REQUIRED_3=["benefit1","benefit2","shopBenefit","title"];

  function tryStep(targetStep, requiredFields) {
    const errs={};
    requiredFields.forEach(k=>{
      const val=f[k];
      if(!val||(Array.isArray(val)&&val.length===0)) errs[k]=true;
    });
    if(Object.keys(errs).length>0){
      setErrors(errs);
      // Scroll to first red field so user sees the error immediately
      setTimeout(()=>{
        const firstEl = document.querySelector("[data-fielderr='true']");
        if(firstEl) firstEl.scrollIntoView({ behavior:"smooth", block:"center" });
      }, 60);
      return;
    }
    setErrors({});
    setStep(targetStep);
  }

  function errStyle(key){ return errors[key]?{border:"2px solid #dc2626",background:"#fef2f2",boxShadow:"0 0 0 3px rgba(220,38,38,0.12)"}:{}; }
  function ErrMsg({fieldKey}){ return errors[fieldKey]?<div data-fielderr="true" style={{fontSize:11,color:"#dc2626",marginTop:3,display:"flex",gap:4,alignItems:"center"}}><span>⚠</span> To pole jest wymagane</div>:null; }

  const steps=[
    ["Produkt","Identyfikacja i specyfikacja",["A. Identyfikacja produktu","B. Specyfikacja jakościowa (opcjonalna)","C. Pola kwiatowe","D. Zdjęcia"]],
    ["Szczegóły","Wolumen, opak., logistyka, cena orientacyjna",["A. Dostępność i wolumen","B. Opakowanie i paletyzacja","C. Logistyka","D. Certyfikaty","E. Cena orientacyjna (opcjonalna)"]],
    ["Prezentacja","Co Cię wyróżnia + nazwa propozycji",["A. Co Cię wyróżnia?","B. Ograniczenie ryzyka","C. Możliwe działania kupca"]]
  ];

  function buildDescription(d){
    const parts=[];
    if(d.qualitySpec) parts.push(`**Jakość i odmiana-** ${d.qualitySpec}`);
    if(d.benefit1||d.benefit2||d.benefit3) parts.push(`**Korzyści-** ${[d.benefit1,d.benefit2,d.benefit3].filter(Boolean).join("; ")}`);
    if(d.riskMitigation) parts.push(`**Ograniczenie ryzyka-** ${d.riskMitigation}`);
    if(d.shopBenefit) parts.push(`**Dla sklepu-** ${d.shopBenefit}`);
    return parts.length ? parts.join("\n") : d.description||"";
  }

  function doSave(status){
    const vol = f.volumeMin&&f.volumeMax ? `${f.volumeMin}-${f.volumeMax}` : f.volumeMin||f.volumeMax||f.volume||"";
    const desc = buildDescription(f);
    const isP = f.positioning==="Premium";
    saveOffer({...f, volume:vol, volumeUnit:f.volumeUnit||"kg", minOrder:f.moq||f.minOrder||"1 Paleta", description:desc, tier:isP?"premium":"standard"}, status);
  }

  const RadioGroup=({name,options,val,onChange})=>(
    <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
      {options.map(v=>(
        <label key={v} style={{ display:"flex",alignItems:"center",gap:6,padding:"6px 14px",border:`1.5px solid ${val===v?"#0d9488":"#e2e8f0"}`,borderRadius:20,fontSize:12,cursor:"pointer",background:val===v?"rgba(13,148,136,0.06)":"white",color:val===v?"#0d9488":"#475569",fontWeight:val===v?600:500 }}>
          <input type="radio" name={name} checked={val===v} onChange={()=>onChange(v)} style={{ display:"none" }}/>{v}
        </label>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth:760 }}>
      {showPrev&&<OfferPreviewModal offer={{...f, volume:f.volumeMin&&f.volumeMax?`${f.volumeMin}-${f.volumeMax}`:f.volume, minOrder:f.moq||f.minOrder||"1 Paleta", description:buildDescription(f)}} co={co} onClose={()=>setShowPrev(false)}/>}
      <div style={{ marginBottom:16,display:"flex",gap:8,alignItems:"center" }}>
        <Btn outline sm onClick={()=>step>1?setStep(step-1):nav("offers")}><ArrowLeft size={13}/> {step>1?"Wróć":"Anuluj"}</Btn>
        {step===3&&<Btn outline sm onClick={()=>setShowPrev(true)} style={{ marginLeft:"auto" }}><Eye size={12}/> Podgląd kupca</Btn>}
      </div>

      {/* Step indicator */}
      <div style={{ display:"flex",gap:0,marginBottom:20,background:"white",borderRadius:10,border:"1px solid #e2e8f0",overflow:"hidden" }}>
        {steps.map(([t,sub,subs],i)=>{
          const n=i+1; const isActive=n===step; const isDone=n<step;
          return (
            <div key={n} style={{ flex:1,padding:"12px 16px",borderRight:i<2?"1px solid #e2e8f0":"none",background:isActive?"#f0fdfa":isDone?"#f8fafc":"white",cursor:isDone?"pointer":"default" }} onClick={()=>isDone&&setStep(n)}>
              <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                <div style={{ width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0,...(isActive?{background:"#0d9488",color:"white"}:isDone?{background:"#059669",color:"white"}:{background:"#e2e8f0",color:"#94a3b8"}) }}>{isDone?"✓":n}</div>
                <div>
                  <div style={{ fontSize:12,fontWeight:600,color:isActive?"#0d9488":isDone?"#059669":"#94a3b8" }}>{t}</div>
                  <div style={{ fontSize:11,color:"#94a3b8" }}>{sub}</div>
                </div>
              </div>
              {isActive&&<div style={{ marginTop:8,paddingLeft:30 }}>
                {subs.map(s=><div key={s} style={{ fontSize:10,color:"#94a3b8",padding:"2px 0" }}>· {s}</div>)}
              </div>}
            </div>
          );
        })}
      </div>

      {/* ════ STEP 1: PRODUKT ════ */}
      {step===1&&<>
        <Card title="A. Identyfikacja produktu" icon={Tag}>
          <Row>
            <Inp label="Nazwa produktu" required value={f.product} onChange={e=>u("product",e.target.value)} placeholder="np. Jabłka, Pomidor malinowy, Róża" style={errStyle("product")}/><ErrMsg fieldKey="product"/>
            <Inp label="Odmiana" required value={f.variety||""} onChange={e=>u("variety",e.target.value)} placeholder="np. Gala, Red Naomi, Malinowy" style={errStyle("variety")}/><ErrMsg fieldKey="variety"/>
          </Row>
          <Row>
            <Inp label="Kategoria" required value={f.category} onChange={e=>u("category",e.target.value)} style={errStyle("category")}>
              <option value="">—</option>{Object.entries(CEMOJI).map(([k,v])=><option key={k} value={k}>{v} {k}</option>)}
            </Inp>
            <Inp label="Podkategoria" value={f.subcategory||""} onChange={e=>u("subcategory",e.target.value)} placeholder="np. jabłka, borówki, sałata, tulipany..."/>
          </Row>
          <Row>
            <Inp label="Kraj pochodzenia" required value={f.origin} onChange={e=>u("origin",e.target.value)} style={errStyle("origin")}>
              <option value="">—</option>{CNAMES_SORTED.map(([k,v])=><option key={k} value={k}>{FLAGS[k]||"🌐"} {v}</option>)}
            </Inp>
            <Inp label="Region / miejscowość" value={f.region||""} onChange={e=>u("region",e.target.value)} placeholder="np. Mazowsze, Almería, Naivasha"/>
          </Row>
          <Row>
            <Inp label="Typ propozycji" required value={f.offerType||""} onChange={e=>u("offerType",e.target.value)} style={errStyle("offerType")} hint="Program stały = całoroczna dostępność. Sezonowa = wąskie okno. Pod promocję = jednorazowy listing z lepszą ceną. Spot = nadwyżka produkcji.">
              <option value="">— wybierz —</option>
              <option>Program stały</option><option>Propozycja sezonowa</option><option>Propozycja pod promocję</option><option>Testowy listing</option><option>Dostawa spot / uzupełnienie braków</option>
            </Inp>
            <Inp label="Rola produktu na półce" required value={f.positioning||""} onChange={e=>u("positioning",e.target.value)} style={errStyle("positioning")} hint="Codzienna = mainstream. Premium = wyższa cena i jakość. Promocja = niska cena z etykietą. Bio = certyfikat. Lokalne = z kraju sieci. Shelf-ready = w opakowaniu RSP.">
              <option value="">— wybierz —</option>
              <option>Codzienna półka</option><option>Premium</option><option>Promocja</option><option>Bio / ekologiczne</option><option>Lokalne / regionalne</option><option>Sezonowe</option><option>Wygodne opakowanie / gotowe na półkę</option>
            </Inp>
          </Row>
        </Card>

        <Card title="B. Specyfikacja jakościowa" icon={Award}>
          <Alrt type="info">Pola w tej sekcji są opcjonalne — uzupełnij tylko jeśli to ważne dla Twojego produktu i kupca. <strong>Skupiamy się na podstawowej specyfikacji</strong>, szczegóły handlowe ustalisz po kontakcie.</Alrt>
          <Row>
            <Inp label="Kaliber / rozmiar" value={f.size||""} onChange={e=>u("size",e.target.value)} placeholder="np. jabłka 70-80 mm · borówki 12+ mm · cytrusy 6 (cal.) · róże 50-60 cm" hint="Standard branżowy lub miara, w której podajesz wielkość produktu."/>
            <Inp label="Klasa jakości" value={f.qualityClass||""} onChange={e=>u("qualityClass",e.target.value)} hint="Klasa I = standard EU (większość obrotu). Extra = top EU. Premium/A = własne klasy sieci. Inna = certyfikaty branżowe (np. GlobalGAP grade).">
              <option value="">— wybierz —</option><option>Klasa I</option><option>Klasa Extra</option><option>Premium</option><option>A</option><option>Inna</option>
            </Inp>
          </Row>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Krótka specyfikacja jakościowa <span style={{ color:"#dc2626" }}>*</span></label>
            <textarea value={f.qualitySpec||""} onChange={e=>u("qualitySpec",e.target.value)} placeholder="jednolity kaliber, dobra jędrność, brak uszkodzeń mechanicznych, stabilna partia przez cały program" rows={3} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",...errStyle("qualitySpec") }}/><ErrMsg fieldKey="qualitySpec"/>
            <div style={{ fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2 }}>{(f.qualitySpec||"").length}/300</div>
          </div>
          <Row>
            <Inp label="Marka / brand" value={f.brand||""} onChange={e=>u("brand",e.target.value)} placeholder="np. Granny Green, FreshPol" hint="opcjonalne — nazwa marki"/>
            <Inp label="Tryb sprzedaży" required value={f.saleMode||""} onChange={e=>u("saleMode",e.target.value)} style={errStyle("saleMode")}>
              <option value="">— wybierz —</option>
              <option>Bez marki</option>
              <option>Marka producenta</option>
              <option>Marka własna sieci (Private label)</option>
              <option>Marka regionalna</option>
            </Inp>
          </Row>
          <div style={{ marginBottom:14,display:"flex",alignItems:"center",gap:10 }}>
            <div onClick={()=>u("isBio",!f.isBio)} style={{ position:"relative",width:40,height:22,flexShrink:0,cursor:"pointer" }}>
              <div style={{ position:"absolute",inset:0,background:f.isBio?"#0d9488":"#cbd5e1",borderRadius:11,transition:"background 0.2s" }}>
                <div style={{ position:"absolute",left:f.isBio?20:3,top:3,width:16,height:16,background:"white",borderRadius:"50%",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)" }}/>
              </div>
            </div>
            <span style={{ fontSize:13,color:"#334155" }}>Produkt posiada certyfikat ekologiczny / Bio</span>
          </div>
          <Row>
            <Inp label="Brix" value={f.brix||""} onChange={e=>u("brix",e.target.value)} placeholder="np. min. 12°Bx"/>
            <Inp label="Kolor / wybarwienie" value={f.colorSpec||""} onChange={e=>u("colorSpec",e.target.value)} placeholder="np. min. 75% czerwonego koloru"/>
          </Row>
        </Card>

        {f.category==="kwiaty"&&<Card title="C. Parametry kwiatowe" icon={Leaf}>
          <Row>
            <Inp label="Długość pędu" required value={f.stemLength||""} onChange={e=>u("stemLength",e.target.value)} placeholder="np. 50 cm, 60 cm"/>
            <Inp label="Faza otwarcia" required value={f.openingPhase||""} onChange={e=>u("openingPhase",e.target.value)} placeholder="np. pąk zamknięty (stage 1), półotwarty (stage 3), pełny (stage 5)" hint="Stadium rozwoju kwiatu w momencie zbioru. Możesz wpisać po polsku."/>
          </Row>
          <Row>
            <Inp label="Liczba szt. w pęczku / bukiecie" required type="number" value={f.bouquetCount||""} onChange={e=>u("bouquetCount",e.target.value)} placeholder="np. 10"/>
            <Inp label="Vase life deklarowane" required value={f.vaseLife||""} onChange={e=>u("vaseLife",e.target.value)} placeholder="np. 7–10 dni"/>
          </Row>
          <Inp label="Kolor / mix kolorów" value={f.flowerColor||""} onChange={e=>u("flowerColor",e.target.value)} placeholder="np. czerwony, mix wiosenny, biały i różowy"/>
        </Card>}

        <Card title="D. Zdjęcia produktu (maks. 3)" icon={Upload}>
          <Alrt type="info">Pierwsze zdjęcie (główne) trafia do nagłówka maila kupca. Zdjęcie opakowania handlowego jest wymagane — kupiec i logistyka muszą widzieć dokładnie co dostają.</Alrt>
          <SimplePhotoUploader
            bucket="offer-photos"
            /* [B2B Round 5.7] Same as company logo above — drop the "tmp"
               fallback. RLS for offer-photos checks first-segment ===
               app_company_id(); a shared "tmp/" folder would have failed RLS
               anyway for non-admin users. Empty pathPrefix triggers
               uploader's own guard with a clear error toast. */
            pathPrefix={co?.id || ""}
            subFolder={`offer-${f.id || "new"}`}
            value={f.photos || []}
            onChange={(newPhotos) => u("photos", newPhotos)}
            multi={true}
            max={3}
            label="Kliknij lub przeciągnij zdjęcia produktu"
          />
          <div style={{ fontSize:11,color:"#94a3b8",marginTop:8 }}>Pierwsze zdjęcie będzie główne w mailu kupca. Zdjęcia są zapisywane w chmurze i widoczne dla wszystkich userów.</div>
        </Card>

        {Object.keys(errors).length>0&&<div style={{ background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:9,padding:"10px 16px",marginBottom:8,display:"flex",gap:8,alignItems:"center",fontSize:13,color:"#dc2626" }}><span style={{fontSize:16}}>⚠</span><div><strong>Uzupełnij wymagane pola:</strong> {Object.keys(errors).map(k=>k).join(", ")}</div></div>}
        <div style={{ display:"flex",justifyContent:"flex-end" }}>
          <Btn primary onClick={()=>tryStep(2,REQUIRED_1)}>Dalej <ArrowLeft size={13} style={{ transform:"rotate(180deg)" }}/></Btn>
        </div>
      </>}

      {/* ════ STEP 2: SZCZEGÓŁY ════ */}
      {step===2&&<>
        <Card title="A. Dostępność i wolumen" icon={Calendar}>
          <Row>
            <Inp label="Dostępność od" required type="month" value={f.from} onChange={e=>u("from",e.target.value)} style={errStyle("from")}/><ErrMsg fieldKey="from"/>
            <Inp label="Dostępność do" required type="month" value={f.to} onChange={e=>u("to",e.target.value)} style={errStyle("to")}/><ErrMsg fieldKey="to"/>
          </Row>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Model dostępności <span style={{ color:"#dc2626" }}>*</span></label>
            <div style={{ padding:errors.availabilityModel?"8px":0,borderRadius:8,...(errors.availabilityModel?{border:"2px solid #dc2626",background:"#fef2f2"}:{}) }}>
              <RadioGroup name="avail" options={["Całorocznie","Sezonowo","Krótkie okno","Tylko promo / spot"]} val={f.availabilityModel||""} onChange={v=>u("availabilityModel",v)}/>
            </div>
            <div style={{ fontSize:11,color:"#94a3b8",marginTop:5 }}>Całorocznie = stabilna dostawa 12 mies. Sezonowo = produkt w określonym oknie (np. truskawki V-VII). Krótkie okno = kilka tygodni. Spot = jednorazowa partia, bez kontynuacji.</div>
            {errors.availabilityModel&&<div style={{fontSize:11,color:"#dc2626",marginTop:3}}>⚠ To pole jest wymagane</div>}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
            <Inp label="Wolumen min. / tydzień" required value={f.volumeMin||""} onChange={e=>u("volumeMin",e.target.value)} placeholder="np. 200" style={errStyle("volumeMin")}/><ErrMsg fieldKey="volumeMin"/>
            <Inp label="Wolumen maks. / tydzień" required value={f.volumeMax||""} onChange={e=>u("volumeMax",e.target.value)} placeholder="np. 500" style={errStyle("volumeMax")}/><ErrMsg fieldKey="volumeMax"/>
            <Inp label="Jednostka" required value={f.volumeUnit||"kg"} onChange={e=>u("volumeUnit",e.target.value)}>
              <option>kg</option><option>t</option><option>kartony</option><option>palety</option><option>sztuki</option><option>pęczki</option><option>bukiety</option><option>wiadra</option>
            </Inp>
          </div>
          <Row>
            <Inp label="Minimalne zamówienie / MOQ" required value={f.moq||""} onChange={e=>u("moq",e.target.value)} placeholder="np. 1 paleta, 200 kartonów" style={errStyle("moq")}/><ErrMsg fieldKey="moq"/>
            <Inp label="Czas realizacji / lead time" required value={f.leadTime||""} onChange={e=>u("leadTime",e.target.value)} placeholder="np. 24 h, 48 h, 3 dni" style={errStyle("leadTime")}/><ErrMsg fieldKey="leadTime"/>
          </Row>
          <Row>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Możliwość zwiększenia wolumenu pod promo? <span style={{ color:"#dc2626" }}>*</span></label>
              <RadioGroup name="promoVol" options={["Tak","Nie"]} val={f.promoVolume||""} onChange={v=>u("promoVolume",v)}/>
            </div>
            {f.promoVolume==="Tak"&&<Inp label="O ile % (przy promo)" value={f.promoVolumePct||""} onChange={e=>u("promoVolumePct",e.target.value)} placeholder="np. 30%"/>}
          </Row>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Dni dostaw <span style={{ fontSize:10,color:"#94a3b8" }}>opcjonalne</span></label>
            <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
              {["Pon","Wt","Śr","Czw","Pt","Sob","Nd"].map(d=>{
                const on=(f.deliveryDays||[]).includes(d);
                return <span key={d} onClick={()=>toggleArr("deliveryDays",d)} style={{ padding:"5px 12px",border:`1.5px solid ${on?"#0d9488":"#e2e8f0"}`,borderRadius:7,fontSize:12,fontWeight:on?600:500,background:on?"rgba(13,148,136,0.08)":"white",color:on?"#0d9488":"#64748b",cursor:"pointer",userSelect:"none" }}>{d}</span>;
              })}
            </div>
          </div>
        </Card>

        <Card title="B. Opakowanie i paletyzacja" icon={Package}>
          <Alrt type="success">Kupiec i magazyn oceniają czy produkt da się wdrożyć zanim trafi na rozmowę. Wymiary palety, liczba kartonów i SRP to często warunki wejścia.</Alrt>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Format handlowy <span style={{ color:"#dc2626" }}>*</span></label>
            <TagToggle items={[["Luz","Luz"],["Flowpack","Flowpack"],["Punnet","Punnet"],["Clamshell","Clamshell"],["Siatka","Siatka"],["Worek","Worek"],["Karton","Karton"],["IFCO","IFCO"],["SRP","SRP"],["Pęczek","Pęczek"],["Bukiet","Bukiet"],["Display","Display"]]} active={f.packaging||[]} onChange={v=>u("packaging",v)}/>
          </div>
          <Inp label="Inne opakowanie" value={f.customPackaging||""} onChange={e=>u("customPackaging",e.target.value)} hint="np. Big Bag, Mesh Bag, Tray, Sleeve..."/>
          <Inp label="Opis opakowania handlowego" required value={f.packagingDesc||""} onChange={e=>u("packagingDesc",e.target.value)} placeholder="np. 12 x 125 g, 10 kg luz, 20 pęczków po 10 szt." style={errStyle("packagingDesc")}/><ErrMsg fieldKey="packagingDesc"/>

          <div style={{ fontSize:11,color:"#64748b",fontWeight:600,marginBottom:10,paddingTop:8,borderTop:"1px solid #f1f5f9" }}>Paletyzacja <span style={{ fontWeight:400,color:"#94a3b8" }}>(opcjonalne)</span></div>
          <Row>
            <Inp label="Typ palety" value={f.palletType||""} onChange={e=>u("palletType",e.target.value)}>
              <option value="">— wybierz —</option><option>EUR</option><option>CHEP</option><option>IFCO</option><option>Inna</option>
            </Inp>
            <Inp label="Wysokość palety" value={f.palletHeight||""} onChange={e=>u("palletHeight",e.target.value)} placeholder="np. 180 cm"/>
          </Row>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
            <Inp label="Kartony na warstwę" value={f.cartonsPerLayer||""} onChange={e=>u("cartonsPerLayer",e.target.value)} placeholder="np. 6"/>
            <Inp label="Warstwy na palecie" value={f.layersPerPallet||""} onChange={e=>u("layersPerPallet",e.target.value)} placeholder="np. 8"/>
            <Inp label="Jedn. handlowych na palecie" value={f.unitsPerPallet||""} onChange={e=>u("unitsPerPallet",e.target.value)} placeholder="np. 576"/>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Shelf-ready (SRP) dostępne?</label>
            <RadioGroup name="srp" options={["Tak","Nie","Do uzgodnienia"]} val={f.srp||""} onChange={v=>u("srp",v)}/>
          </div>
        </Card>

        <Card title="C. Logistyka i reklamacje" icon={Zap}>
          <Row>
            <Inp label="Model dostawy" required value={f.deliveryModel||""} onChange={e=>u("deliveryModel",e.target.value)} style={errStyle("deliveryModel")}>
              <option value="">— wybierz —</option>
              <option>Centrum dystrybucyjne (CD)</option><option>Cross-dock</option><option>Bezpośrednio do sklepów</option><option>EXW</option><option>FCA</option><option>DDP</option>
            </Inp>
            <Inp label="Miejsce załadunku" required value={f.loadingPoint||""} onChange={e=>u("loadingPoint",e.target.value)} placeholder="np. Recz, Mazowsze, Almería" style={errStyle("loadingPoint")}/><ErrMsg fieldKey="loadingPoint"/>
          </Row>
          <Inp label="Obsługiwane kraje / regiony dostaw" required value={f.deliveryRegions||""} onChange={e=>u("deliveryRegions",e.target.value)} placeholder="np. PL, DE, CZ, NL — cała CEE" style={errStyle("deliveryRegions")}/><ErrMsg fieldKey="deliveryRegions"/>
          <Row>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Transport <span style={{ color:"#dc2626" }}>*</span></label>
              <RadioGroup name="cold" options={["Po stronie dostawcy","Po stronie kupca","Możliwe oba warianty","Do ustalenia","Nie dotyczy"]} val={f.coldChain||""} onChange={v=>u("coldChain",v)}/>
              <div style={{ fontSize:10,color:"#94a3b8",marginTop:4 }}>Wskaż, kto organizuje transport. Może to być Twoja firma, firma kurierska lub kupiec.</div>
            </div>
            <Inp label="Temperatura transportu" value={f.tempTransport||""} onChange={e=>u("tempTransport",e.target.value)} placeholder="np. 2–6°C, 8–10°C (kwiaty)" hint="opcjonalne — często zależy od trasy"/>
          </Row>
        </Card>

        <Card title="D. Certyfikaty i identyfikowalność" icon={ShieldCheck}>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Pełna identyfikowalność partii <span style={{ color:"#dc2626" }}>*</span></label>
            <div style={{ padding:errors.traceability?"8px":0,borderRadius:8,...(errors.traceability?{border:"2px solid #dc2626",background:"#fef2f2"}:{}) }}>
              <RadioGroup name="trace" options={["Tak","Nie"]} val={f.traceability||""} onChange={v=>u("traceability",v)}/>
            </div>
            {errors.traceability&&<div style={{fontSize:11,color:"#dc2626",marginTop:3}}>⚠ To pole jest wymagane</div>}
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Certyfikaty</label>
            <TagToggle items={[["GlobalGAP","GlobalG.A.P."],["GRASP","GRASP"],["Bio","EU Organic / Bio"],["Rainforest Alliance","Rainforest Alliance"],["Fairtrade","Fairtrade"],["SMETA","SMETA"],["HACCP","HACCP"],["BRC","IFS / BRCGS"],["MPS-ABC","MPS-ABC"],["MPS-GAP","MPS-GAP"]]} active={f.certs||[]} onChange={v=>u("certs",v)}/>
          </div>
          <Inp label="Inny certyfikat" value={f.customCert||""} onChange={e=>u("customCert",e.target.value)} hint="np. USDA Organic, Tesco Nurture..."/>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12 }}>
            <Inp label="Numer certyfikatu" value={f.certNumber||""} onChange={e=>u("certNumber",e.target.value)} placeholder="np. 4056186695431"/>
            <Inp label="Ważny do" type="date" value={f.certValid||""} onChange={e=>u("certValid",e.target.value)}/>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Aktualne badania?</label>
              <RadioGroup name="tests" options={["Tak","Nie"]} val={f.currentTests||""} onChange={v=>u("currentTests",v)}/>
            </div>
          </div>
        </Card>

        <Card title="E. Warunki handlowe i cena orientacyjna" icon={CreditCard}>
          <Alrt type="info">
            <strong>Cena jest opcjonalna i ma charakter orientacyjny.</strong> Preconnect to system propozycji asortymentowych, a nie klasyczne ofertowanie cenowe. Możesz podać cenę orientacyjną, zakres, lub zostawić pole puste — kupiec zapyta o cenę po kontakcie. Każda cena wyświetlona kupcowi pojawi się z dopiskiem: <em>„Cena ma charakter orientacyjny i wymaga potwierdzenia z dostawcą".</em>
          </Alrt>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
            <Inp label="Waluta" value={f.currency||"EUR"} onChange={e=>u("currency",e.target.value)}>
              <option>PLN</option><option>EUR</option><option>USD</option>
            </Inp>
            <Inp label="Cena orientacyjna" type="number" value={f.priceOffer||""} onChange={e=>u("priceOffer",e.target.value)} placeholder="np. 2.40 — cena min. z poprzedniego tygodnia" hint="Opcjonalne. Pokazuje kupcowi rząd wielkości — finalna cena zostaje do uzgodnienia bilateralnie. Wpływ INCOTERMS: DAP/DDP zwykle wyżej, EXW niżej."/>
            <Inp label="Jednostka ceny" value={f.priceUnit||"kg"} onChange={e=>u("priceUnit",e.target.value)}>
              <option>kg</option><option>szt.</option><option>karton</option><option>paleta</option><option>pęczek</option><option>bukiet</option>
            </Inp>
          </div>
          <Row>
            <Inp label="Baza ceny / Incoterm" value={f.incoterm||""} onChange={e=>u("incoterm",e.target.value)}>
              <option value="">— wybierz —</option><option>EXW</option><option>FCA</option><option>DDP</option><option>CPT</option><option>Inne</option>
            </Inp>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Cena obowiązuje od — do</label>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                <input type="date" value={f.priceFrom||""} onChange={e=>u("priceFrom",e.target.value)} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" }}/>
                <input type="date" value={f.priceTo||""} onChange={e=>u("priceTo",e.target.value)} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" }}/>
              </div>
            </div>
          </Row>
          <Row>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Cena promocyjna możliwa?</label>
              <RadioGroup name="promoP" options={["Tak","Nie"]} val={f.promoPrice||""} onChange={v=>u("promoPrice",v)}/>
            </div>
            <div>
              <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Program sezonowy / kontraktowy?</label>
              <RadioGroup name="contractP" options={["Tak","Nie"]} val={f.contractProgram||""} onChange={v=>u("contractProgram",v)}/>
            </div>
          </Row>
          <div>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Dostępność próbek</label>
            <RadioGroup name="samplesA" options={["Tak — wyślemy","Po uzgodnieniu","Nie"]} val={f.samplesAvail||""} onChange={v=>u("samplesAvail",v)}/>
          </div>
        </Card>

        {Object.keys(errors).length>0&&<div style={{ background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:9,padding:"10px 16px",marginBottom:8,display:"flex",gap:8,alignItems:"center",fontSize:13,color:"#dc2626" }}><span style={{fontSize:16}}>⚠</span><div><strong>Uzupełnij wymagane pola</strong> — podświetlone na czerwono powyżej.</div></div>}
        <div style={{ display:"flex",justifyContent:"space-between" }}>
          <Btn outline onClick={()=>setStep(1)}><ArrowLeft size={13}/> Wróć</Btn>
          <Btn primary onClick={()=>tryStep(3,REQUIRED_2)}>Dalej <ArrowLeft size={13} style={{ transform:"rotate(180deg)" }}/></Btn>
        </div>
      </>}

      {/* ════ STEP 3: PREZENTACJA ════ */}
      {step===3&&<>
        <Alrt type="warning"><strong>Nie pisz:</strong> wysoka jakość · konkurencyjna cena · indywidualne podejście · wieloletnie doświadczenie.<br/><strong>Pisz konkretnie:</strong> standard partii, wolumen, logistyka, cena, czas reakcji, korzyść dla kupca.</Alrt>

        {/* [B2B Round prod-rollout / UX] Codex feedback: krótki przykład dobrej
            oferty w jednej linii — pokazuje strukturę "produkt + kaliber + klasa
            + wolumen + logistyka", którą kupiec rozumie od razu. */}
        <details style={{ marginBottom:16,background:"#f0fdfa",border:"1px solid #99f6e4",borderRadius:10,padding:"10px 14px" }}>
          <summary style={{ cursor:"pointer",fontSize:13,fontWeight:600,color:"#0d9488",userSelect:"none" }}>📋 Pokaż przykład dobrej oferty (1 zdanie)</summary>
          <div style={{ marginTop:10,fontSize:13,color:"#134e4a",lineHeight:1.6 }}>
            <div style={{ padding:"10px 12px",background:"white",borderRadius:8,fontFamily:"ui-monospace, SF Mono, monospace",fontSize:12,color:"#1e293b",border:"1px solid #ccfbf1",marginBottom:8 }}>
              „Jabłka Gala 70-80 mm, klasa I, 100 t/mies., dostawa DAP do centrum dystrybucji"
            </div>
            <div style={{ fontSize:11,color:"#64748b",lineHeight:1.5 }}>
              Każde pole konkretne i mierzalne: <strong>produkt + odmiana + kaliber + klasa + wolumen + logistyka</strong>. Kupiec wie od razu czego się spodziewać. Tego samego ducha trzymaj się w 3 pytaniach poniżej — operacyjnie, w liczbach.
            </div>
          </div>
        </details>

        <Card title="A. Co Cię wyróżnia?" icon={CheckCircle}>
          <Alrt type="success">
            <strong>To najważniejsza sekcja — ważniejsza niż cena.</strong> Odpowiedz konkretnie na 3 pytania, dlaczego kupiec ma wybrać właśnie Twoją propozycję. Nie pisz frazesów — pisz operacyjne, mierzalne fakty.
          </Alrt>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Inspiracje — kliknij żeby dodać</label>
            <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
              {["powtarzalna jakość","stabilna podaż","niski shrink","szybka reklamacja","gotowość do promocji","opakowanie shelf-ready","private label","wsparcie marketingowe","wsparcie sprzedaży","identyfikowalność partii","badania i dokumentacja","lokalne / regionalne","wygoda dla sklepu","wygoda dla shoppera"].map(b=>(
                <span key={b} onClick={()=>{ if(!f.benefit1){u("benefit1",b);}else if(!f.benefit2){u("benefit2",b);}else if(!f.benefit3){u("benefit3",b);} }} style={{ padding:"3px 10px",background:"white",border:"1px solid #a7f3d0",borderRadius:20,fontSize:11,color:"#047857",cursor:"pointer",userSelect:"none" }}>{b}</span>
              ))}
            </div>
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:14 }}>
            {[
              ["benefit1","1","*","Dlaczego kupiec powinien zainteresować się tym produktem?","np. powtarzalna jakość partii przez cały program — sortownia optyczna, klasa I gwarantowana"],
              ["benefit2","2","*","Co robisz lepiej lub inaczej niż inni dostawcy?","np. stabilna podaż 200–500 t/mies. z własnej chłodni CA — brak zależności od skupu"],
              ["benefit3","3","opcj.","Jak zmniejszasz ryzyko dla kupca?","np. reklamacje rozpatrywane tego samego dnia, plan B: 2 packhousy + 5 gospodarstw partnerskich"]
            ].map(([key,num,req,question,ph])=>(
              <div key={key}>
                <div style={{ display:"flex",gap:8,alignItems:"flex-start",marginBottom:4 }}>
                  <div style={{ width:22,height:22,borderRadius:"50%",background:errors[key]?"#fef2f2":"#0d9488",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0,color:errors[key]?"#dc2626":"white",marginTop:2 }}>{num}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12,fontWeight:600,color:"#334155",marginBottom:4 }}>{question} <span style={{ fontSize:10,color:req==="*"?"#dc2626":"#94a3b8",fontWeight:500 }}>{req==="*"?"wymagane":"opcjonalne"}</span></div>
                    <input type="text" value={f[key]||""} onChange={e=>u(key,e.target.value)} placeholder={ph} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",boxSizing:"border-box",...errStyle(key) }}/>
                  </div>
                </div>
                <ErrMsg fieldKey={key}/>
              </div>
            ))}
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:600,color:"#334155",display:"block",marginBottom:5 }}>Jak ten produkt pomoże sieci sprzedawać więcej lub lepiej? <span style={{ color:"#dc2626" }}>*</span></label>
            <textarea value={f.shopBenefit||""} onChange={e=>u("shopBenefit",e.target.value)} placeholder="format wygodny dla półki, niska odpadowość, możliwość akcji sezonowej, wsparcie materiałami POS, gotowy do ekspozycji" rows={3} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",...errStyle("shopBenefit") }}/><ErrMsg fieldKey="shopBenefit"/>
            <div style={{ fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2 }}>{(f.shopBenefit||"").length}/250</div>
          </div>
        </Card>

        <Card title="B. Bezpieczeństwo współpracy" icon={ShieldCheck}>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:600,color:"#334155",display:"block",marginBottom:5 }}>Jak zabezpieczasz jakość i ciągłość dostaw? <span style={{ fontSize:10,color:"#94a3b8",fontWeight:500,background:"#f1f5f9",padding:"1px 6px",borderRadius:4 }}>opcjonalne</span></label>
            <textarea value={f.riskMitigation||""} onChange={e=>u("riskMitigation",e.target.value)} placeholder="monitoring jakości partii, reakcja reklamacyjna tego samego dnia, pełna identyfikowalność od pola do dostawy, dokumentacja online, plan awaryjny: 2 packhousy + 5 gospodarstw partnerskich" rows={3} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",}}/>
            <div style={{ fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2 }}>{(f.riskMitigation||"").length}/350</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Co potwierdza Twoją wiarygodność? <span style={{ fontSize:10,color:"#94a3b8",fontWeight:500 }}>opcjonalne</span></label>
            <textarea value={f.riskProof||""} onChange={e=>u("riskProof",e.target.value)} placeholder="obsługiwane rynki: PL/DE/CZ, stałe wolumeny od 2019, referencje retail (na żądanie), zdjęcia procesu, aktualne badania GlobalGAP" rows={2} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box" }}/>
            <div style={{ fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2 }}>{(f.riskProof||"").length}/300</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12,fontWeight:500,display:"block",marginBottom:5 }}>Dlaczego warto rozmawiać teraz? <span style={{ fontSize:10,color:"#94a3b8",fontWeight:500 }}>opcjonalne</span></label>
            <textarea value={f.riskNow||""} onChange={e=>u("riskNow",e.target.value)} placeholder="np. start sezonu jesiennego — jabłka klasy Extra dostępne od września, wysoka dostępność z chłodni CA, okno przed promocją świąteczną" rows={2} style={{ width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box" }}/>
            <div style={{ fontSize:10,color:"#94a3b8",textAlign:"right",marginTop:2 }}>{(f.riskNow||"").length}/200</div>
          </div>
        </Card>

        <Card title="C. Możliwe działania kupca" icon={Send}>
          <Alrt type="info">
            <strong>Uwaga:</strong> akcje są po stronie kupca. To kupiec decyduje, co zrobić po obejrzeniu Twojej propozycji. Może poprosić o próbkę, zapytać o aktualną cenę i wolumen, poprosić o specyfikację, umówić rozmowę, zapytać o program sezonowy albo umówić spotkanie na Fresh Market. Może też skontaktować się z Tobą bezpośrednio, korzystając z danych kontaktowych podanych w profilu.
          </Alrt>
        </Card>

        <Card title="Nazwa propozycji dla kupca" icon={FileText}>
          <Alrt type="info"><strong>To tytuł Twojej propozycji widoczny dla kupca na liście propozycji.</strong> Powinien od razu mówić, co oferujesz i dlaczego warto kliknąć w szczegóły. Wpisz produkt, kraj lub region pochodzenia oraz jeden najmocniejszy wyróżnik, np. sezon, kaliber, dostępność, certyfikat albo format opakowania.</Alrt>
          <Inp label="Nazwa propozycji dla kupca" required value={f.title} onChange={e=>u("title",e.target.value)} hint={`${(f.title||"").length}/200`} placeholder="np. Winogrona stołowe Murcja — bezpestkowe, kaliber AA, sezon VII–X" style={errStyle("title")}/><ErrMsg fieldKey="title"/>
          <div style={{ marginTop:10,padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}>
            <Inp label="Własna nazwa propozycji" value={f.internalTitle||""} onChange={e=>u("internalTitle",e.target.value)} placeholder="np. Gala premium — wariant dla dużych sieci" hint="Niewidoczne dla kupca"/>
            <div style={{ fontSize:11,color:"#64748b",marginTop:4,lineHeight:1.5 }}>To nazwa robocza tylko dla Ciebie. Kupiec jej nie zobaczy. Użyj jej, żeby łatwo rozróżniać podobne propozycje w swoim panelu, np. wariant dla dużych sieci, propozycję sezonową albo wariant premium.</div>
          </div>
        </Card>

        <div style={{ display:"flex",gap:8,justifyContent:"space-between",marginBottom:24 }}>
          <Btn outline onClick={()=>setStep(2)}><ArrowLeft size={13}/> Wróć</Btn>
          <div style={{ display:"flex",gap:8 }}>
            <Btn outline onClick={()=>setShowPrev(true)}><Eye size={13}/> Podgląd</Btn>
            <Btn outline onClick={()=>doSave("draft")}>Zapisz szkic</Btn>
            <Btn primary onClick={()=>{ const errs={}; REQUIRED_3.forEach(k=>{ const v=f[k]; if(!v||(Array.isArray(v)&&v.length===0)) errs[k]=true; }); if(Object.keys(errs).length>0){setErrors(errs);setTimeout(()=>{const el=document.querySelector("[data-fielderr='true']");if(el)el.scrollIntoView({behavior:"smooth",block:"center"});},60);return;} doSave("active"); }}>Opublikuj propozycję</Btn>
          </div>
        </div>
      </>}
    </div>
  );
}

/* ── Finanse: tabs Saldo / Historia / Pakiety ─────────────────────────── */
function PageFinanse({ wallet, sends, offers, co, setCo, fl, nav, buyPackage, orders, pkgMax, pkgUsed, retailers, accountId }) {
  function getRetailerLive(id) {
    return (retailers||[]).find(r=>r.id===id) || null;
  }
  const [tab,setTab]=useState("saldo");

  const allSent=sends.filter(s=>(!s.supplierId||s.supplierId===accountId)&&!["queued","pending_moderation","rejected"].includes(s.status));
  const confirmed=allSent.filter(s=>["read","read_manual"].includes(s.status));
  const allExpired=allSent.filter(s=>s.status==="unread_expired");
  const expired=allExpired.filter(hasRefundMarker);
  const refundedExpired = expired;
  const pendingRefunds = allExpired.filter(s => !hasRefundMarker(s));
  const pkgOpt=PKG_OPTS.find(p=>p.id===co.pkg)||PKG_OPTS[2];
  const pct=Math.min(100,Math.round(allSent.length/pkgOpt.max*100));
  const totalEarned=confirmed.length*pkgOpt.perSend;
  const totalRefunds=refundedExpired.reduce((sum, s) => sum + getRefundAmount(s), 0);

  return (
    <div style={{ maxWidth:860 }}>
      <div style={{ display:"flex",gap:0,marginBottom:20,background:"#f1f5f9",borderRadius:10,padding:4,width:"fit-content" }}>
        {[["saldo","Saldo i pakiet"],["historia","Historia wysylek"],["pakiety","Cennik i pakiety"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px 18px",borderRadius:8,border:"none",background:tab===t?"white":"transparent",fontWeight:tab===t?600:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",color:tab===t?"#1e293b":"#64748b",boxShadow:tab===t?"0 1px 4px rgba(0,0,0,0.08)":"none",whiteSpace:"nowrap" }}>{l}</button>
        ))}
      </div>

      {tab==="saldo"&&<>
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:14,padding:"22px 26px",marginBottom:16,display:"flex",gap:24,alignItems:"stretch",flexWrap:"wrap" }}>
          <div style={{ flex:1,minWidth:160 }}>
            <div style={{ fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:1,marginBottom:5 }}>Saldo portfela</div>
            <div style={{ fontSize:40,fontWeight:800,color:"white",lineHeight:1 }}>{wallet.balance}<span style={{ fontSize:16,fontWeight:400,marginLeft:4 }}>EUR</span></div>
            <div style={{ fontSize:12,color:"rgba(255,255,255,0.45)",marginTop:6 }}>Srodki na kolejne wysylki - {getPlanById(co.pkg)?.perSend||40} EUR/szt.</div>
            <div style={{ marginTop:14 }}><Btn onClick={()=>nav("wysylki")} style={{ background:"rgba(255,255,255,0.12)",color:"white",border:"1px solid rgba(255,255,255,0.2)" }}><Send size={13}/> Wyslij propozycje</Btn></div>
          </div>
          <div style={{ display:"flex",gap:10,flexWrap:"wrap",alignItems:"center" }}>
            {[["Wyslano lacznie",allSent.length,"mailingow","rgba(255,255,255,0.07)","white"],["Potwierdzone odczyty",confirmed.length,"propozycji","rgba(5,150,105,0.22)","#6ee7b7"],["Zwroty",refundedExpired.length,"propozycji","rgba(239,68,68,0.18)","#fca5a5"]].map(([l,v,u,bg,c])=>(
              <div key={l} style={{ padding:"12px 16px",background:bg,borderRadius:10,border:"1px solid rgba(255,255,255,0.06)",minWidth:100,textAlign:"center" }}>
                <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
                <div style={{ fontSize:10,color:c,opacity:0.75 }}>{u}</div>
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:1 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:16 }}>
          {[["Efektywny koszt",`${totalEarned-totalRefunds} EUR`,"po zwrotach","#7c3aed"],["Zwroty",`+${totalRefunds} EUR`,pendingRefunds.length>0?"zaksiegowane / w toku":"na portfel","#059669"],["Open rate",allSent.length?Math.round(confirmed.length/allSent.length*100)+"%":"0%","potwierdzonych",confirmed.length/Math.max(1,allSent.length)>=0.5?"#059669":"#d97706"]].map(([l,v,sub,c])=>(
            <div key={l} style={{ padding:"12px 14px",background:"white",border:"1px solid #e2e8f0",borderRadius:10 }}>
              <div style={{ fontSize:11,color:"#94a3b8",marginBottom:3 }}>{l}</div>
              <div style={{ fontSize:20,fontWeight:800,color:c }}>{v}</div>
              <div style={{ fontSize:11,color:"#94a3b8",marginTop:1 }}>{sub}</div>
            </div>
          ))}
        </div>

        <Card title="Aktywny pakiet" icon={CreditCard}>
          <div style={{ display:"flex",gap:14,alignItems:"center",flexWrap:"wrap" }}>
            <div style={{ padding:"12px 20px",background:"linear-gradient(135deg,#1e3a5f,#2563eb)",borderRadius:10,color:"white",flexShrink:0 }}>
              <div style={{ fontSize:10,opacity:0.6,marginBottom:2 }}>PAKIET</div>
              <div style={{ fontSize:14,fontWeight:700 }}>{pkgOpt.label}</div>
              <div style={{ fontSize:11,opacity:0.6,marginTop:2 }}>{pkgOpt.perSend} EUR/szt.</div>
            </div>
            <div style={{ flex:1,minWidth:200 }}>
              <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5 }}>
                <span style={{ color:"#64748b" }}>Uzyto: {allSent.length}/{pkgOpt.max} wysylek</span>
                <span style={{ fontWeight:600,color:pct>=90?"#dc2626":pct>=70?"#d97706":"#059669" }}>{pct}%</span>
              </div>
              <div style={{ background:"#e2e8f0",borderRadius:4,height:8,overflow:"hidden" }}><div style={{ height:"100%",background:pct>=90?"#dc2626":pct>=70?"#d97706":"#0d9488",borderRadius:4,width:`${pct}%` }}/></div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10 }}>
                {[["Cena pakietu",`${pkgOpt.price} EUR`],["Wazny do",co.pkgExpiry||"2026-12-31"]].map(([l,v])=><div key={l} style={{ padding:"7px 10px",background:"#f8fafc",borderRadius:7,border:"1px solid #e2e8f0" }}><div style={{ fontSize:10,color:"#94a3b8" }}>{l}</div><div style={{ fontWeight:600,fontSize:12 }}>{v}</div></div>)}
              </div>
            </div>
          </div>
          <div style={{ marginTop:14 }}><Btn outline sm onClick={()=>setTab("pakiety")}><CreditCard size={12}/> Zmien pakiet</Btn></div>
        </Card>

        {expired.length>0&&<Card title="Zwroty za brak odczytu" icon={RotateCcw} style={{ borderLeft:"3px solid #059669" }}>
          <Alrt type="success"><strong>{expired.length} zwroty = +{totalRefunds} EUR</strong> wrocily na portfel. Mozesz je wykorzystac na wysylki do innych sieci.</Alrt>
          {expired.map(s=>{ const o=getOffer(s.offerId,offers); const r=getRetailerLive(s.retailerId); return (
            <div key={s.id} style={{ display:"flex",gap:10,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <RotateCcw size={12} color="#059669"/>
              <div style={{ flex:1 }}>{CEMOJI[o?.category]} <strong>{o?.title||o?.product}</strong>{" -> "}{r?.name}</div>
              <strong style={{ color:"#059669" }}>+{getRefundAmount(s)} EUR</strong>
            </div>
          );})}
        </Card>}
        {pendingRefunds.length>0&&<Card title="Zwroty w toku" icon={RotateCcw} style={{ borderLeft:"3px solid #d97706" }}>
          <Alrt type="warning"><strong>{pendingRefunds.length} {pendingRefunds.length===1?"zwrot jest":"zwroty sa"} w toku.</strong> Status propozycji jest juz wygaszony, ale zapis zwrotu jeszcze dojezdza do portfela.</Alrt>
          {pendingRefunds.map(s=>{ const o=getOffer(s.offerId,offers); const r=getRetailerLive(s.retailerId); return (
            <div key={s.id} style={{ display:"flex",gap:10,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <RotateCcw size={12} color="#d97706"/>
              <div style={{ flex:1 }}>{CEMOJI[o?.category]} <strong>{o?.title||o?.product}</strong>{" -> "}{r?.name}</div>
              <strong style={{ color:"#d97706" }}>zwrot w toku</strong>
            </div>
          );})}
        </Card>}

        <Card title="Ostatnie transakcje" icon={FileText}>
          {(wallet.transactions || []).map((t,i)=>(
            <div key={i} style={{ display:"flex",gap:10,alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f1f5f9" }}>
              <div style={{ width:30,height:30,borderRadius:"50%",background:t.type==="refund"?"#d1fae5":t.type==="credit"?"#dbeafe":"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                {t.type==="refund"?<RotateCcw size={12} color="#059669"/>:t.type==="credit"?<Plus size={12} color="#2563eb"/>:<X size={12} color="#dc2626"/>}
              </div>
              <div style={{ flex:1 }}><div style={{ fontSize:13 }}>{t.desc}</div><div style={{ fontSize:11,color:"#94a3b8" }}>{t.date}</div></div>
              <div style={{ fontWeight:700,color:t.amount>0?"#059669":"#dc2626" }}>{t.amount>0?"+":""}{t.amount} EUR</div>
            </div>
          ))}
        </Card>
      </>}

      {tab==="historia"&&<Card title="Historia wysylek" noPad>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr style={{ background:"#f8fafc" }}>{["Propozycja","Siec","Tier","Data","Status","Kwota"].map(h=><th key={h} style={{ padding:"10px 14px",textAlign:"left",fontSize:11,textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {allSent.map(s=>{ const o=getOffer(s.offerId,offers); const r=getRetailerLive(s.retailerId); const sc=STATUS_MAP[s.status]; const isConf=["read","read_manual"].includes(s.status); return (
                <tr key={s.id} style={{ background:s.status==="unread_expired"?"#fef9f9":isConf?"#f0fdf4":"white" }}>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9",fontSize:13 }}><div style={{ display:"flex",gap:5,alignItems:"center" }}>{CEMOJI[o?.category]} <strong>{o?.title||o?.product}</strong></div></td>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9" }}><div style={{ display:"flex",gap:6,alignItems:"center" }}><RetailerLogo retailer={r} size={16}/><span style={{ fontSize:12 }}>{r?.name}</span></div></td>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9" }}>{o?.tier==="premium"?<Badge color="#d97706" bg="#fef3c7">Premium</Badge>:<Badge color="#3b82f6" bg="#eff6ff">Standard</Badge>}</td>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,color:"#64748b" }}>{s.sentAt||s.sendDate}</td>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9" }}><span title={STATUS_TIPS[s.status]||""} style={{cursor:"help",display:"inline-flex",alignItems:"center",gap:2}}>
                    <Badge color={sc?.[1]}>{sc?.[0]}</Badge>
                    {(s.status==="pending_moderation"||s.status==="queued")&&<Info size={11} color={sc?.[1]} style={{verticalAlign:"middle"}}/>}
                  </span></td>
                  <td style={{ padding:"9px 14px",borderBottom:"1px solid #f1f5f9",fontWeight:700,fontSize:13 }}>{s.status==="unread_expired"?(hasRefundMarker(s)?<span style={{ color:"#059669" }}>+{getRefundAmount(s)} EUR</span>:<span style={{ color:"#d97706" }}>zwrot w toku</span>):isConf?<span style={{ color:"#1e293b" }}>{pkgOpt.perSend} EUR</span>:<span style={{ color:"#94a3b8" }}>oczekuje</span>}</td>
                </tr>
              );})}
              {allSent.length===0&&<tr><td colSpan={6} style={{ padding:24,textAlign:"center",color:"#94a3b8" }}>Brak wysylek.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>}

      {tab==="pakiety"&&<PageFinansePakiety co={co} setCo={setCo} fl={fl} buyPackage={buyPackage} orders={orders} wallet={wallet} pkgMax={pkgMax} pkgUsed={pkgUsed}/>}
    </div>
  );
}

function PageFinansePakiety({ co, setCo, fl, buyPackage, orders, wallet, pkgMax, pkgUsed }) {
  const [selected, setSelected] = useState(co.pkg||"std_10");
  const [showModal, setShowModal] = useState(false);
  const [payMethod, setPayMethod] = useState("karta");
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const sel = getPlanById(selected) || PRICING_PLANS[2];
  const rem = Math.max(0, pkgMax - pkgUsed);

  // [B2B Round prod-rollout / faza 3] Realne PayU zamiast mocka buyPackage().
  // Wywołuje Netlify function create-payu-order, dostaje redirectUri do
  // hosted checkout i przekierowuje przeglądarkę. Po finalizacji PayU notify
  // wywoła purchase_package RPC i user wróci na /zakup-ok.
  async function handleOrder() {
    setPaying(true);
    try {
      const { redirectUri } = await dbCreatePayuOrder(selected);
      if (!redirectUri) throw new Error("PayU nie zwrócił adresu przekierowania");
      // Redirect przed setPaying(false), żeby nie migotać UI.
      window.location.href = redirectUri;
    } catch (e) {
      setPaying(false);
      fl(`Błąd inicjalizacji płatności: ${e?.message || "spróbuj ponownie"}`, "error");
    }
  }

  return (
    <div>
      {/* Payment modal */}
      {showModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <div style={{ background:"white",borderRadius:16,padding:28,maxWidth:460,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            {paid?(
              <div style={{ textAlign:"center",padding:"8px 0" }}>
                <div style={{ width:64,height:64,borderRadius:"50%",background:"#d1fae5",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}>
                  <CheckCircle size={32} color="#059669"/>
                </div>
                <h3 style={{ margin:"0 0 8px",fontSize:18,color:"#0f172a" }}>Płatność potwierdzona!</h3>
                <p style={{ color:"#64748b",fontSize:13,margin:"0 0 16px",lineHeight:1.6 }}>
                  Pakiet <strong>{sel.tier==="PREMIUM"?"Premium":"Standard"} {sel.qty} {sel.qty===1?"wysyłka":"wysyłek"}</strong> został aktywowany.<br/>
                  Dodano <strong style={{ color:"#0d9488" }}>+{sel.qty} wysyłek</strong> do Twojego konta.
                </p>
                <div style={{ padding:"10px 16px",background:"#f0fdf4",borderRadius:8,fontSize:13,color:"#047857",border:"1px solid #bbf7d0" }}>
                  Aktualny stan: <strong>{pkgMax + sel.qty} wysyłek łącznie</strong>
                </div>
              </div>
            ):(
              <>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20 }}>
                  <div style={{ width:40,height:40,borderRadius:10,background:"#f0fdfa",border:"1px solid #bbf7d0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                    <CreditCard size={20} color="#0d9488"/>
                  </div>
                  <div>
                    <h3 style={{ margin:0,fontSize:16 }}>Potwierdź zamówienie</h3>
                    <div style={{ fontSize:12,color:"#64748b",marginTop:2 }}>Faktura VAT zostanie wysłana na e-mail</div>
                  </div>
                  <button onClick={()=>setShowModal(false)} style={{ marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:4 }}><X size={18}/></button>
                </div>
                <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 16px",marginBottom:16 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:13 }}><span style={{ color:"#64748b" }}>Pakiet</span><span style={{ fontWeight:600 }}>{sel.tier==="PREMIUM"?"⭐ Premium":"Standard"} · {sel.qty} {sel.qty===1?"wysyłka":"wysyłek"}</span></div>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:13 }}><span style={{ color:"#64748b" }}>Cena/szt.</span><span>{sel.perSend} EUR</span></div>
                  {sel.discount>0&&<div style={{ display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:13 }}><span style={{ color:"#64748b" }}>Zniżka</span><span style={{ color:"#059669",fontWeight:600 }}>−{sel.discount}% vs cena bazowa</span></div>}
                  <div style={{ borderTop:"1px solid #e2e8f0",paddingTop:10,marginTop:4,display:"flex",justifyContent:"space-between" }}>
                    <span style={{ fontWeight:700,fontSize:15 }}>Netto</span>
                    <span style={{ fontWeight:800,fontSize:18,color:"#0d9488" }}>{sel.price} EUR</span>
                  </div>
                  <div style={{ display:"flex",justifyContent:"space-between",marginTop:4,fontSize:12,color:"#94a3b8" }}><span>VAT 23%</span><span>+{Math.round(sel.price*0.23)} EUR</span></div>
                  <div style={{ display:"flex",justifyContent:"space-between",marginTop:2 }}><span style={{ fontSize:13,fontWeight:600,color:"#475569" }}>Brutto</span><span style={{ fontSize:15,fontWeight:800,color:"#1e293b" }}>{Math.round(sel.price*1.23)} EUR</span></div>
                </div>
                <div style={{ marginBottom:16 }}>
                  <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:8,color:"#334155" }}>Metoda płatności</label>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
                    {[["karta","💳","Karta płatnicza"],["przelew","🏦","Przelew bankowy"],["portfel","💰",`Z portfela (${wallet.balance} EUR)`]].map(([val,icon,lbl])=>(
                      <label key={val} onClick={()=>setPayMethod(val)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 6px",border:`2px solid ${payMethod===val?"#0d9488":"#e2e8f0"}`,borderRadius:8,cursor:"pointer",background:payMethod===val?"#f0fdfa":"white",userSelect:"none" }}>
                        <span style={{ fontSize:20 }}>{icon}</span>
                        <span style={{ fontSize:10,fontWeight:payMethod===val?700:400,color:payMethod===val?"#0d9488":"#64748b",textAlign:"center",lineHeight:1.3 }}>{lbl}</span>
                        {val==="portfel"&&wallet.balance<sel.price&&<span style={{ fontSize:9,color:"#dc2626" }}>Za mało środków</span>}
                      </label>
                    ))}
                  </div>
                  {payMethod==="portfel"&&wallet.balance<sel.price&&<div style={{ marginTop:8,fontSize:12,color:"#dc2626",background:"#fef2f2",padding:"6px 10px",borderRadius:6,border:"1px solid #fca5a5" }}>Brakuje {sel.price-wallet.balance} EUR — doładuj portfel lub wybierz inną metodę.</div>}
                </div>
                {payMethod==="karta"&&(
                  <div style={{ background:"#f8fafc",borderRadius:8,padding:"12px 14px",marginBottom:16,border:"1px solid #e2e8f0" }}>
                    <div style={{ fontSize:11,color:"#94a3b8",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5 }}>Dane karty (demo – wpisz cokolwiek)</div>
                    <div style={{ display:"grid",gap:8 }}>
                      <input placeholder="1234 5678 9012 3456" style={{ padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,fontFamily:"inherit",letterSpacing:1 }}/>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                        <input placeholder="MM/YY" style={{ padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,fontFamily:"inherit" }}/>
                        <input placeholder="CVV" style={{ padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,fontFamily:"inherit" }}/>
                      </div>
                      <input placeholder="Imię i nazwisko na karcie" style={{ padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,fontFamily:"inherit" }}/>
                    </div>
                  </div>
                )}
                {payMethod==="przelew"&&(
                  <div style={{ background:"#f0f9ff",borderRadius:8,padding:"12px 14px",marginBottom:16,border:"1px solid #bae6fd",fontSize:12,color:"#0369a1" }}>
                    <strong>Dane do przelewu:</strong><br/>
                    KJOW Sp. z o.o. · PKO BP<br/>
                    <span style={{ fontFamily:"monospace",fontSize:13 }}>PL 12 1440 1101 0000 0000 1234 5678</span><br/>
                    Tytuł: <strong>FM-{selected.toUpperCase()}-{new Date().getFullYear()}</strong>
                    <div style={{ marginTop:6,padding:"5px 8px",background:"rgba(3,105,161,0.08)",borderRadius:5,fontSize:11 }}>Po zaksięgowaniu (1–2 dni robocze) wysyłki zostaną dodane automatycznie.</div>
                  </div>
                )}
                <div style={{ display:"flex",gap:8 }}>
                  <Btn outline onClick={()=>setShowModal(false)} style={{ flex:1 }}>Anuluj</Btn>
                  <Btn primary disabled={paying||(payMethod==="portfel"&&wallet.balance<sel.price)} onClick={handleOrder} style={{ flex:2,background:sel.tier==="PREMIUM"?"#d97706":"#0d9488" }}>
                    {paying?<><RefreshCw size={13} style={{ animation:"spin 1s linear infinite" }}/> Przetwarzanie…</>:<><CreditCard size={13}/> Zapłać {Math.round(sel.price*1.23)} EUR (z VAT)</>}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Current package status */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20 }}>
        {[[`${pkgMax}`,"Łącznie w pakietach","wysyłek","#0d9488"],[`${pkgUsed}`,"Wykorzystano","wysyłek","#3b82f6"],[`${rem}`,"Pozostało","wysyłek",rem>0?"#059669":"#dc2626"]].map(([v,l,sub,c])=>(
          <div key={l} style={{ padding:"14px 16px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,borderTop:`3px solid ${c}` }}>
            <div style={{ fontSize:26,fontWeight:800,color:c }}>{v}</div>
            <div style={{ fontSize:12,fontWeight:600,color:"#475569",marginTop:2 }}>{l}</div>
            <div style={{ fontSize:11,color:"#94a3b8" }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"flex",gap:10,padding:"12px 16px",background:"#f0fdf4",borderRadius:10,marginBottom:20,border:"1px solid #bbf7d0",fontSize:13,color:"#047857" }}>
        <ShieldCheck size={16} color="#059669" style={{ flexShrink:0,marginTop:1 }}/>
        <div>Gwarancja 14 dni — brak odczytu przez kupca = automatyczny zwrot kredytu na portfel. Kupujesz wysyłki, nie ryzyko.</div>
      </div>

      {/* [B2B Round prod-rollout / UX] Codex feedback: jasne porównanie
          Standard vs Premium. Uczciwe — bez obietnic których nie potwierdzimy.
          Realne różnice: pozycja w mailu, oznaczenie "Premium", cena/szt. */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22 }}>
        <div style={{ background:"white",border:"1px solid #bfdbfe",borderRadius:10,padding:"14px 16px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
            <span style={{ background:"#dbeafe",color:"#1e40af",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700 }}>STANDARD</span>
            <span style={{ fontSize:12,color:"#64748b",fontWeight:600 }}>40-30 EUR / wysyłka</span>
          </div>
          <ul style={{ margin:0,paddingLeft:18,fontSize:12,color:"#475569",lineHeight:1.7 }}>
            <li><strong>Pozycja środkowa</strong> w newsletterze do kupca</li>
            <li>Pełna treść propozycji + Twoje zdjęcia i logo</li>
            <li>Moderacja przed wysyłką (24h SLA)</li>
            <li>Gwarancja 14 dni — zwrot przy braku odczytu</li>
          </ul>
          <div style={{ marginTop:10,padding:"7px 10px",background:"#eff6ff",borderRadius:6,fontSize:11,color:"#1e3a5f",lineHeight:1.5 }}>
            <strong>Kiedy wybrać:</strong> chcesz dużo wysyłek po niższej cenie/szt. — najlepsze dla wolumenowych dostawców.
          </div>
        </div>

        <div style={{ background:"white",border:"2px solid #fde68a",borderRadius:10,padding:"14px 16px",position:"relative" }}>
          <div style={{ position:"absolute",top:-8,right:14,background:"#d97706",color:"white",fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:10,letterSpacing:0.5 }}>⭐ TOP POZYCJA</div>
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
            <span style={{ background:"#fef3c7",color:"#92400e",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700 }}>PREMIUM</span>
            <span style={{ fontSize:12,color:"#92400e",fontWeight:600 }}>80-45 EUR / wysyłka</span>
          </div>
          <ul style={{ margin:0,paddingLeft:18,fontSize:12,color:"#475569",lineHeight:1.7 }}>
            <li><strong>Twoja propozycja jako pierwsza</strong> w newsletterze</li>
            <li>Oznaczenie <span style={{ background:"#fef3c7",color:"#92400e",padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:700 }}>Premium</span> w mailu — wyróżnienie wizualne</li>
            <li>Pełna treść + zdjęcia + logo (jak Standard)</li>
            <li>Gwarancja 14 dni — zwrot przy braku odczytu</li>
          </ul>
          <div style={{ marginTop:10,padding:"7px 10px",background:"#fffbeb",borderRadius:6,fontSize:11,color:"#78350f",lineHeight:1.5 }}>
            <strong>Kiedy wybrać:</strong> stawiasz na widoczność i chcesz żeby kupiec zobaczył Cię od razu — najlepsze dla premium produktów, kategorii nowych dla sieci, kluczowych okien sezonu.
          </div>
        </div>
      </div>

      {/* Standard table */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:10 }}>
          <span style={{ background:"#dbeafe",color:"#1e40af",padding:"3px 12px",borderRadius:20,fontSize:12,fontWeight:700 }}>STANDARD</span>
          <span style={{ fontSize:12,color:"#64748b" }}>Pozycja środkowa w newsletterze</span>
        </div>
        <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr style={{ background:"#f8fafc" }}>{["Pakiet","Cena","Cena/szt.","Zniżka",""].map(h=><th key={h} style={{ padding:"9px 14px",textAlign:"left",fontSize:11,textTransform:"uppercase",color:"#64748b",borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
            <tbody>{PRICING_PLANS.filter(p=>p.tier==="STANDARD").map(plan=>{ const isSel=selected===plan.id; return (
              <tr key={plan.id} onClick={()=>setSelected(plan.id)} style={{ cursor:"pointer",background:isSel?"#eff6ff":"white",borderLeft:isSel?"3px solid #2563eb":"3px solid transparent" }}>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9" }}><div style={{ display:"flex",gap:7,alignItems:"center" }}>{plan.popular&&<span style={{ background:"#0d9488",color:"white",fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:8 }}>Popularny</span>}<strong style={{ color:isSel?"#2563eb":"#1e293b" }}>{plan.qty} {plan.qty===1?"wysyłka":"wysyłek"}</strong></div></td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontWeight:700 }}>{plan.price} EUR</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9",color:"#475569" }}>{plan.perSend} EUR</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9" }}>{plan.discount>0?<span style={{ background:"#d1fae5",color:"#047857",padding:"2px 8px",borderRadius:10,fontSize:12,fontWeight:700 }}>−{plan.discount}%</span>:<span style={{ color:"#94a3b8",fontSize:12 }}>bazowa</span>}</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9" }}>{isSel&&<span style={{ background:"#2563eb",color:"white",padding:"3px 10px",borderRadius:6,fontSize:12 }}>Wybrany</span>}</td>
              </tr>
            );})}
            </tbody>
          </table>
        </div>
      </div>

      {/* Premium table */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:10 }}>
          <span style={{ background:"#fef3c7",color:"#92400e",padding:"3px 12px",borderRadius:20,fontSize:12,fontWeight:700 }}>PREMIUM</span>
          <span style={{ fontSize:12,color:"#64748b" }}>TOP pozycja — Twoja propozycja jako pierwsza w newsletterze</span>
        </div>
        <div style={{ background:"white",border:"2px solid #fde68a",borderRadius:10,overflow:"hidden" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr style={{ background:"#fffbeb" }}>{["Pakiet","Cena","Cena/szt.","Zniżka",""].map(h=><th key={h} style={{ padding:"9px 14px",textAlign:"left",fontSize:11,textTransform:"uppercase",color:"#92400e",borderBottom:"1px solid #fde68a" }}>{h}</th>)}</tr></thead>
            <tbody>{PRICING_PLANS.filter(p=>p.tier==="PREMIUM").map(plan=>{ const isSel=selected===plan.id; return (
              <tr key={plan.id} onClick={()=>setSelected(plan.id)} style={{ cursor:"pointer",background:isSel?"#fef3c7":"white",borderLeft:isSel?"3px solid #d97706":"3px solid transparent" }}>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #fef3c7" }}><div style={{ display:"flex",gap:7,alignItems:"center" }}><Star size={11} color="#d97706" fill="#d97706"/>{plan.popular&&<span style={{ background:"#d97706",color:"white",fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:8 }}>Popularny</span>}<strong style={{ color:isSel?"#b45309":"#1e293b" }}>{plan.qty} {plan.qty===1?"wysyłka":"wysyłek"}</strong></div></td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #fef3c7",fontWeight:700 }}>{plan.price} EUR</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #fef3c7",color:"#475569" }}>{plan.perSend} EUR</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #fef3c7" }}>{plan.discount>0?<span style={{ background:"#fde68a",color:"#92400e",padding:"2px 8px",borderRadius:10,fontSize:12,fontWeight:700 }}>−{plan.discount}%</span>:<span style={{ color:"#94a3b8",fontSize:12 }}>bazowa</span>}</td>
                <td style={{ padding:"10px 14px",borderBottom:"1px solid #fef3c7" }}>{isSel&&<span style={{ background:"#d97706",color:"white",padding:"3px 10px",borderRadius:6,fontSize:12 }}>Wybrany</span>}</td>
              </tr>
            );})}
            </tbody>
          </table>
        </div>
      </div>

      {/* CTA */}
      <div style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:12,padding:"16px 20px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",marginBottom:24 }}>
        <div style={{ flex:1,color:"white" }}>
          <div style={{ fontWeight:700,fontSize:15 }}>{sel.tier==="PREMIUM"?"⭐ Premium":"Standard"} · {sel.qty} {sel.qty===1?"wysyłka":"wysyłek"}</div>
          <div style={{ fontSize:12,opacity:0.6,marginTop:2 }}>{sel.price} EUR netto · {sel.perSend} EUR/szt.{sel.discount>0?` · –${sel.discount}% zniżka`:""}</div>
        </div>
        <Btn onClick={()=>setShowModal(true)} style={{ background:sel.tier==="PREMIUM"?"#d97706":"#0d9488",color:"white",border:"none",flexShrink:0,fontWeight:700 }}>
          <CreditCard size={13}/> Zamów pakiet
        </Btn>
      </div>

      {/* Order history */}
      {orders.length>0&&(
        <Card title="Historia zamówień" icon={FileText}>
          {[...orders].reverse().map(ord=>(
            <div key={ord.id} style={{ display:"flex",gap:12,padding:"10px 0",borderBottom:"1px solid #f1f5f9",alignItems:"center" }}>
              <div style={{ width:36,height:36,borderRadius:8,background:ord.planId.startsWith("prem")?"#fef3c7":"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                <CreditCard size={15} color={ord.planId.startsWith("prem")?"#d97706":"#2563eb"}/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600,fontSize:13 }}>{ord.planLabel}</div>
                <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>
                  {ord.date} · {ord.paymentMethod==="karta"?"💳 Karta":ord.paymentMethod==="przelew"?"🏦 Przelew":"💰 Portfel"} · +{ord.qty} wysyłek
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:700,fontSize:13,color:"#dc2626" }}>−{ord.price} EUR</div>
                <Badge color="#059669" bg="#f0fdf4">Opłacone</Badge>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
/* ── Dashboard kupca — 2 bloki: PreConnect + Fresh Market 2026 ────────────── */
function PageBuyerDashboard({ nav, fmSettings, buyer, sends, buyerRetailerId }) {
  const fmOpen = fmSettings?.schedulingOpen;
  const unread = sends
    ? sends.filter(s =>
        ["sent","opened"].includes(s.status) &&
        (!buyerRetailerId || s.retailerId === buyerRetailerId)
      ).length
    : 0;
  const [howOpenBuy, setHowOpenBuy] = useState(false);

  return (
    <div style={{ maxWidth:860 }}>

      {/* ── Jak to działa? — Buyer ── */}
      <div style={{ marginBottom:20,background:"white",borderRadius:12,border:"1px solid #e2e8f0",overflow:"hidden" }}>
        <div onClick={()=>setHowOpenBuy(v=>!v)} style={{ display:"flex",alignItems:"center",gap:10,padding:"13px 18px",cursor:"pointer",userSelect:"none" }}>
          <Info size={15} color="#2563eb"/>
          <span style={{ fontWeight:700,fontSize:14,color:"#1e293b",flex:1 }}>Jak to działa?</span>
          <span style={{ fontSize:12,color:"#94a3b8" }}>{howOpenBuy?"Zwiń ▲":"Rozwiń ▼"}</span>
        </div>
        {howOpenBuy && (
          <div style={{ padding:"0 18px 18px",borderTop:"1px solid #f1f5f9" }}>
            <p style={{ fontSize:13,color:"#334155",lineHeight:1.7,marginTop:14,marginBottom:12 }}>
              Witamy w panelu kupca Fresh Market. Ten panel służy do dwóch rzeczy: przeglądania <strong>propozycji asortymentowych od dostawców</strong> w module PreConnect oraz <strong>wyboru firm do spotkań</strong> podczas Fresh Market 2026.
            </p>

            <div style={{ fontWeight:700,fontSize:13,color:"#0d9488",marginBottom:8,display:"flex",alignItems:"center",gap:6 }}>
              <Send size={13}/> Moduł PreConnect
            </div>
            <ul style={{ margin:"0 0 14px 0",paddingLeft:18,display:"flex",flexDirection:"column",gap:7 }}>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Propozycje asortymentowe:</strong> W tej sekcji otrzymujesz oferty od dostawców dopasowane do Twojej sieci handlowej.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Ocena propozycji:</strong> Możesz otworzyć szczegóły produktu, sprawdzić parametry, logistykę, certyfikaty i materiały dodatkowe.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Zapisane:</strong> Jeśli oferta jest interesująca, możesz ją zapisać do późniejszego przeglądu.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65,background:"#f0fdf4",padding:"6px 10px",borderRadius:7,listStyle:"none",marginLeft:-18,border:"1px solid #bbf7d0" }}>⭐ <strong>Status odczytu:</strong> Otwarcie szczegółów oznacza, że propozycja została odczytana przez kupca.</li>
            </ul>

            <div style={{ fontWeight:700,fontSize:13,color:"#7c3aed",marginBottom:8,display:"flex",alignItems:"center",gap:6 }}>
              <Calendar size={13}/> Spotkania B2B — Fresh Market 2026
            </div>
            <ul style={{ margin:"0 0 14px 0",paddingLeft:18,display:"flex",flexDirection:"column",gap:7 }}>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Wybór dostawców:</strong> W tej sekcji widzisz firmy, które chcą spotkać się z Twoją siecią podczas Fresh Market 2026.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Twoja decyzja:</strong> Możesz oznaczyć dostawcę jako: <em>Chcę spotkanie</em>, <em>Daj szansę</em> albo <em>Nie</em>.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Plan spotkań:</strong> Na podstawie decyzji kupców i wyborów dostawców system przygotowuje propozycję harmonogramu spotkań.</li>
              <li style={{ fontSize:12,color:"#475569",lineHeight:1.65 }}><strong>Publikacja wyników:</strong> Finalny plan spotkań pojawi się w panelu po zatwierdzeniu przez organizatora.</li>
            </ul>

            <div style={{ fontWeight:700,fontSize:12,color:"#334155",marginBottom:6 }}>Pomoc</div>
            <p style={{ fontSize:12,color:"#475569",lineHeight:1.65,margin:0 }}>
              Jeśli masz pytania lub widzisz błędne dane, skontaktuj się z organizatorem przez czat lub dane kontaktowe w panelu.
            </p>
          </div>
        )}
      </div>

      {/* ════ BLOK 1: PRECONNECT ════ */}
      <div style={{ background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:16,padding:"28px 28px",marginBottom:16 }}>
        <div style={{ display:"flex",alignItems:"flex-start",gap:14,marginBottom:20 }}>
          <div style={{ width:48,height:48,borderRadius:12,background:"rgba(13,148,136,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
            <Send size={22} color="#6ee7b7"/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ color:"white",fontWeight:800,fontSize:18,marginBottom:8 }}>PreConnect</div>
            <div style={{ color:"rgba(255,255,255,0.7)",fontSize:13,lineHeight:1.8,maxWidth:580 }}>
              <strong style={{ color:"#6ee7b7" }}>Przeglądaj propozycje od dostawców</strong> dopasowane do Twojej sieci.<br/>
              Otwieraj szczegóły, porównuj produkty i zapisuj najciekawsze oferty.
            </div>
            {unread>0&&(
              <div style={{ marginTop:12,padding:"10px 14px",background:"rgba(13,148,136,0.2)",border:"1px solid rgba(13,148,136,0.4)",borderRadius:9,fontSize:12,color:"#6ee7b7",display:"flex",alignItems:"center",gap:8 }}>
                <Bell size={14}/>
                <span>{unread} {unread===1?"nowa propozycja czeka":"nowych propozycji czeka"} na przeczytanie</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
          <button onClick={()=>nav("b-offers")} style={{ padding:"14px 18px",background:"rgba(13,148,136,0.85)",border:"1px solid rgba(13,148,136,0.5)",borderRadius:10,color:"white",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:10 }}>
            <Send size={17}/><div><div style={{ fontWeight:700,fontSize:14 }}>Zobacz propozycje</div><div style={{ fontSize:11,opacity:0.75,marginTop:2 }}>Propozycje asortymentowe od dostawców</div></div>
          </button>
          <button onClick={()=>nav("b-katalog")} style={{ padding:"14px 18px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,color:"white",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:10 }}>
            <Building2 size={17}/><div><div style={{ fontWeight:700,fontSize:14 }}>Baza dostawców</div><div style={{ fontSize:11,opacity:0.65,marginTop:2 }}>Profile firm i certyfikaty</div></div>
          </button>
        </div>
      </div>

      {/* ════ BLOK 2: FRESH MARKET 2026 ════ */}
      <div style={{ borderRadius:16,border:fmOpen?"2px solid #059669":"1px solid #e2e8f0",background:fmOpen?"linear-gradient(135deg,#f0fdf4,#ecfdf5)":"white",padding:"28px 28px",position:"relative",overflow:"hidden" }}>
        {!fmOpen&&<div style={{ position:"absolute",top:0,left:0,right:0,height:4,background:"linear-gradient(90deg,#e2e8f0,#f1f5f9)" }}/>}
        <div style={{ display:"flex",alignItems:"flex-start",gap:14,marginBottom:20 }}>
          <div style={{ width:48,height:48,borderRadius:12,background:fmOpen?"rgba(5,150,105,0.15)":"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
            <Calendar size={22} color={fmOpen?"#059669":"#94a3b8"}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap" }}>
              <span style={{ fontWeight:800,fontSize:18,color:fmOpen?"#0f172a":"#94a3b8" }}>Fresh Market 2026</span>
              {fmOpen
                ? <span style={{ background:"#059669",color:"white",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20 }}>● AKTYWNE</span>
                : <span style={{ background:"#f1f5f9",color:"#94a3b8",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20 }}>🔒 ZAMKNIĘTE</span>
              }
            </div>
            <div style={{ fontSize:13,color:fmOpen?"#334155":"#94a3b8",lineHeight:1.8,maxWidth:580 }}>
              <strong style={fmOpen?{color:"#059669"}:{color:"#94a3b8"}}>Wybieraj dostawców, z którymi chcesz spotkać się podczas wydarzenia.</strong> Oznacz firmy jako <em>Chcę spotkanie</em>, <em>Daj szansę</em> lub <em>Nie</em>, a system przygotuje plan rozmów.<br/>
              {fmOpen
                ? <>Wskaż wybory do <strong>16 września</strong>. Finalny harmonogram: <strong>22 września</strong>.</>
                : <>Rejestracja zostanie otwarta wkrótce. Wybory: do <strong>16 września 2026</strong>. Finalny harmonogram: <strong>22 września</strong>.</>
              }
            </div>
          </div>
        </div>
        {!fmOpen&&(
          <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:20 }}>
            {[["🎯","do 16 września","Wskazujesz firmy, z którymi chcesz się spotkać"],["🔒","16 września","Zamknięcie wyborów — dalsze zmiany tylko przez administratora"],["⚙️","17–22 września","Algorytm + ręczne korekty administratora"],["📋","22 września","Publikacja finalnego harmonogramu i numerów"],["🎪","24 września","Event — Fresh Market 2026"]].map(([ic,d,sub])=>(
              <div key={d} style={{ flex:1,minWidth:120,padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}>
                <div style={{ fontSize:16,marginBottom:3 }}>{ic}</div>
                <div style={{ fontSize:11,fontWeight:700,color:"#334155" }}>{d}</div>
                <div style={{ fontSize:11,color:"#94a3b8",marginTop:2,lineHeight:1.4 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}
        {fmOpen&&(
          <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:16 }}>
<button onClick={()=>nav("fm-sched")} style={{ padding:"13px 22px",background:"#059669",border:"none",borderRadius:10,color:"white",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8 }}>
              <Calendar size={15}/> Przejdź do Spotkań FM 2026
            </button>
            <button onClick={()=>nav("fm-sched")} style={{ padding:"13px 22px",background:"white",border:"2px solid #059669",borderRadius:10,color:"#059669",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8 }}>
              <Users size={15}/> Zobacz spotkania
            </button>
          </div>
        )}
        <div style={{ paddingTop:14,borderTop:"1px solid #e2e8f0",fontSize:11,color:"#94a3b8" }}>
          Pytania? Kontakt: <strong>Oksana Kozłowska</strong> · oksana@freshmarket.eu · +48 603 811 818
        </div>
      </div>
    </div>
  );
}


function PageBuyerOffers({ sends, offers, nav, buyer, toggleStar, co, buyerRetailerId, retailers, companies, initialFilter }) {
  const STATUS_VISIBLE = ["sent","read","read_manual","opened","unread_expired"];
  const mySends = buyerRetailerId ? (sends||[]).filter(s => {
    if(!STATUS_VISIBLE.includes(s.status)) return false;
    if(s.retailerId !== buyerRetailerId) return false;
    if(retailers) {
      const retailer = retailers.find(r=>r.id===buyerRetailerId);
      if(retailer) {
        if(retailer.active===false) return false;
        const offer = getOffer(s.offerId, offers);
        if (buyer?.active === false) return false;
        const myCats = buyer?.cats || [];
        if(myCats.length && offer?.category && !myCats.includes(offer.category)) {
          return false;
        }
      }
    }
    return true;
  }) : [];
  const getDisplayCo = (s) => getSupplierCo(s, offers, companies);
  const [filters,setFilters]=useState({ category:"",country:"",cert:"",volumeMin:"",packaging:"",starred:initialFilter?.starred||false,verified:false,withPhotos:false,companyType:"" });
  const visible=mySends.filter(s=>!["queued","pending_moderation","approved","rejected"].includes(s.status));
  const sorted=[...visible].sort((a,b)=>{ const oa=getOffer(a.offerId,offers); const ob=getOffer(b.offerId,offers); const tA=oa?.tier==="premium"?0:1; const tB=ob?.tier==="premium"?0:1; if(tA!==tB) return tA-tB; return (a.pos||99)-(b.pos||99); });
  const filtered=sorted.filter(s=>{
    const o=getOffer(s.offerId,offers); if(!o) return false;
    if(!applyFilters([o],filters,buyer.starred||[]).length) return false;
    const dCo=getDisplayCo(s);
    const allCerts=[...(o.certs||[]),o.customCert].filter(Boolean);
    if(filters.verified && allCerts.length===0) return false;
    if(filters.withPhotos && (o.photos||[]).length===0) return false;
    if(filters.companyType && !(dCo?.types||[]).includes(filters.companyType)) return false;
    return true;
  });
  const premiumCount=filtered.filter(s=>getOffer(s.offerId,offers)?.tier==="premium").length;
  const starredCount=(buyer.starred||[]).length;
  const isSavedView = initialFilter?.starred;
  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#0d9488",marginBottom:4 }}>{isSavedView?"Zapisane":"PreConnect"}</div>
        <div style={{ fontSize:22,fontWeight:800,color:"#0f172a",marginBottom:4,letterSpacing:-0.3 }}>{isSavedView?"Zapisane propozycje":"Propozycje asortymentowe"}</div>
        <div style={{ fontSize:13,color:"#64748b",lineHeight:1.5,maxWidth:680 }}>
          {isSavedView
            ? <>Propozycje, które oznaczyłeś jako ciekawe.</>
            : <>Konkretne produkty od zweryfikowanych dostawców. <span style={{ color:"#94a3b8" }}>Każda propozycja pokazuje, kto za nią stoi — typ firmy, kraj, certyfikaty.</span></>
          }
        </div>
      </div>
      <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap" }}>
        <Stat hero label="Propozycje" value={filtered.length} sub={`${premiumCount} Premium · ${filtered.length-premiumCount} Standard`}/>
        <Stat label="Zapisane" value={starredCount} color="#059669" sub="oznaczone"/>
      </div>

      {/* Quick filters — szybkie odrzucanie */}
      <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:10 }}>
        {[
          { key:"verified", label:"Z certyfikatami", icon:"✓", color:"#059669" },
          { key:"withPhotos", label:"Ze zdjęciami", icon:"📷", color:"#0d9488" },
          { key:"starred", label:"Zapisane", icon:"♥", color:"#dc2626" },
        ].map(q => (
          <button key={q.key} onClick={()=>setFilters(f=>({...f,[q.key]:!f[q.key]}))}
            style={{ padding:"6px 12px",fontSize:12,fontWeight:filters[q.key]?700:500,borderRadius:20,
              border:`1.5px solid ${filters[q.key]?q.color:"#e2e8f0"}`,
              background:filters[q.key]?`${q.color}10`:"white",
              color:filters[q.key]?q.color:"#64748b",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5 }}>
            <span>{q.icon}</span> {q.label}
          </button>
        ))}
        <select value={filters.companyType} onChange={e=>setFilters(f=>({...f,companyType:e.target.value}))}
          style={{ padding:"6px 10px",fontSize:12,borderRadius:20,border:`1.5px solid ${filters.companyType?"#7c3aed":"#e2e8f0"}`,background:filters.companyType?"#faf5ff":"white",color:filters.companyType?"#7c3aed":"#64748b",cursor:"pointer",fontFamily:"inherit",fontWeight:filters.companyType?700:500 }}>
          <option value="">Typ firmy: wszystkie</option>
          {Object.entries(TYPE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <OfferFilters filters={filters} setFilters={setFilters} showStarred/>
      {filters.starred&&starredCount===0&&<Alrt type="warning">Brak propozycji oznaczonych jako zapisane.</Alrt>}
      {filtered.length===0&&!filters.starred&&<Alrt>Brak propozycji spełniających kryteria.</Alrt>}
      {filtered.map(s=>{ const o=getOffer(s.offerId,offers); if(!o) return null;
        const dCo=getDisplayCo(s);
        const isPremium=o.tier==="premium"; const isStarred=(buyer.starred||[]).includes(o.id); const isNew=["sent","opened"].includes(s.status);
        const allCerts=[...(o.certs||[]),o.customCert].filter(Boolean);
        const hasVerification = allCerts.length>0;
        const hasPhotos = (o.photos||[]).length>0;
        const coInitials = (dCo?.name||"FM").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
        const coTypes = (dCo?.types||[]).slice(0,2);
        return (
          <div key={s.id} style={{ background:isPremium?"linear-gradient(135deg,#fffbeb,#fff7ed)":"white",border:isPremium?"2px solid #fbbf24":"1px solid #e2e8f0",borderRadius:12,padding:16,marginBottom:10,position:"relative",overflow:"hidden",boxShadow:"0 1px 2px rgba(15,23,42,0.04)" }}>
            {isPremium&&<div style={{ position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#f59e0b,#d97706)" }}/>}

            {/* ── HEADER: dostawca = mocno widoczny ── */}
            <div style={{ display:"flex",gap:12,alignItems:"flex-start",marginBottom:12,paddingBottom:12,borderBottom:"1px solid #f1f5f9" }}>
              {/* Logo firmy — duże */}
              <div style={{ width:56,height:56,borderRadius:12,background:dCo?.logo?"white":"linear-gradient(135deg,#1e3a5f,#0d9488)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"white",flexShrink:0,letterSpacing:-0.5,boxShadow:"0 2px 6px rgba(15,23,42,0.08)",border:dCo?.logo?"1px solid #e2e8f0":"none",overflow:"hidden" }}>
                {dCo?.logo
                  ? <img src={dCo.logo} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/>
                  : coInitials
                }
              </div>
              {/* Nazwa + typ firmy + kraj */}
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:3 }}>
                  <span style={{ fontWeight:800,fontSize:15,color:"#0f172a",letterSpacing:-0.2 }}>{dCo?.name||"Dostawca"}</span>
                  {hasVerification
                    ? <Badge color="#059669" bg="#ecfdf5"><CheckCircle size={9} style={{ verticalAlign:"middle",marginRight:2 }}/> Certyfikaty podane</Badge>
                    : <Badge color="#dc2626" bg="#fef2f2"><AlertTriangle size={9} style={{ verticalAlign:"middle",marginRight:2 }}/> Brak podanych certyfikatów</Badge>
                  }
                </div>
                <div style={{ display:"flex",gap:5,flexWrap:"wrap",alignItems:"center" }}>
                  {coTypes.map(t=><span key={t} style={{ fontSize:11,padding:"2px 8px",borderRadius:10,background:"#f1f5f9",color:"#475569",fontWeight:600 }}>{TYPE_LABELS[t]||t}</span>)}
                  <span style={{ fontSize:12,color:"#64748b" }}>{FLAGS[dCo?.country]||"🌐"} {CNAMES[dCo?.country]||dCo?.country||""}{dCo?.city?` · ${dCo.city}`:""}</span>
                </div>
              </div>
              {/* Save + open buttons */}
              <div style={{ display:"flex",gap:6,flexShrink:0,alignItems:"center" }}>
                <button onClick={()=>toggleStar(o.id)} title={isStarred?"Usuń z zapisanych":"Zapisz"}
                  style={{ width:36,height:36,borderRadius:8,border:`1.5px solid ${isStarred?"#dc2626":"#e2e8f0"}`,background:isStarred?"#fef2f2":"white",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",transition:"all 0.15s" }}>
                  <Heart size={15} color={isStarred?"#dc2626":"#94a3b8"} fill={isStarred?"#dc2626":"none"}/>
                </button>
                <Btn primary sm onClick={()=>nav("b-detail",s.id)}><ExternalLink size={11}/> Szczegóły</Btn>
              </div>
            </div>

            {/* ── PRODUKT: zdjęcie + tytuł + meta ── */}
            <div style={{ display:"flex",gap:12,alignItems:"flex-start" }}>
              {/* Miniatura - tylko zdjęcie głowne (pierwsze) */}
              {hasPhotos
                ? <div style={{ position:"relative",flexShrink:0 }}>
                    <img src={o.photos[0]} alt="" style={{ width:90,height:90,objectFit:"cover",borderRadius:8,border:"1px solid #e2e8f0" }}/>
                    {(o.photos||[]).length>1 && (
                      <span style={{ position:"absolute",bottom:4,right:4,background:"rgba(15,23,42,0.75)",color:"white",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:10 }}>+{o.photos.length-1}</span>
                    )}
                  </div>
                : <div style={{ width:90,height:90,borderRadius:8,background:"#f8fafc",border:"1px dashed #e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,flexDirection:"column",color:"#cbd5e1",fontSize:11 }}>
                    <span style={{ fontSize:30,marginBottom:2 }}>{CEMOJI[o.category]||"📦"}</span>
                    <span style={{ fontSize:9 }}>brak zdjęć</span>
                  </div>
              }
              <div style={{ flex:1,minWidth:0 }}>
                {/* Badges */}
                <div style={{ display:"flex",gap:5,alignItems:"center",marginBottom:5,flexWrap:"wrap" }}>
                  {isPremium&&<Badge color="#d97706" bg="#fef3c7"><Star size={9} fill="#d97706" color="#d97706"/> Premium</Badge>}
                  {isNew&&<Badge color="#0d9488">Nowa</Badge>}
                  {o.positioning&&<Badge color="#7c3aed" bg="#faf5ff">{o.positioning}</Badge>}
                  {o.isBio&&<Badge color="#059669" bg="#f0fdf4">🌿 Bio</Badge>}
                  <Badge>{FLAGS[o.origin]||"🌐"} {CNAMES[o.origin]||o.origin}</Badge>
                </div>
                {/* Nazwa propozycji = produkt */}
                <div style={{ fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:3,letterSpacing:-0.1 }}>{o.title||o.product}</div>
                {/* Meta */}
                <div style={{ fontSize:12,color:"#64748b",marginBottom:6,lineHeight:1.5 }}>
                  {o.product&&o.product!==o.title&&<><strong style={{ color:"#475569" }}>{o.product}</strong>{o.variety?` · ${o.variety}`:""} · </>}
                  {o.volumeMin&&o.volumeMax?`${o.volumeMin}–${o.volumeMax} ${o.volumeUnit||""}`:o.volume?`${o.volume} ${o.volumeUnit||""}`:""}
                  {o.moq&&<> · Min. zamówienie: {o.moq}</>}
                  {o.leadTime&&<> · Czas realizacji: {o.leadTime}</>}
                </div>
                {/* Certyfikaty */}
                {allCerts.length>0&&(
                  <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:6 }}>
                    {allCerts.map(c=><Badge key={c} color="#0d9488"><Award size={9} style={{verticalAlign:"middle",marginRight:2}}/>{c}</Badge>)}
                    {o.deliveryRegions&&<Badge color="#64748b">📍 {o.deliveryRegions}</Badge>}
                  </div>
                )}
                {/* Wyróżnik / korzyść */}
                {(o.benefit1||o.benefit2)&&(
                  <div style={{ fontSize:12,color:"#047857",marginBottom:5,lineHeight:1.5 }}>
                    ✅ {[o.benefit1,o.benefit2].filter(Boolean).join(" · ")}
                  </div>
                )}
                {!o.benefit1&&o.description&&(
                  <div style={{ fontSize:12,color:"#64748b" }}>{(o.description||"").replace(/\*\*[^*]+\*\*/g,"").slice(0,110)}…</div>
                )}
                {/* Cena orientacyjna z disclaimerem */}
                {o.priceOffer&&(
                  <div style={{ display:"inline-flex",alignItems:"center",gap:7,marginTop:4,padding:"5px 10px",background:"#fffbeb",borderRadius:7,border:"1px solid #fde68a",fontSize:11 }}>
                    <span style={{ fontWeight:700,color:"#92400e" }}>{o.priceOffer} {o.currency||"EUR"}/{o.priceUnit||"kg"}</span>
                    <span style={{ color:"#a16207",fontStyle:"italic" }}>cena orientacyjna · do potwierdzenia</span>
                  </div>
                )}
                {/* Brakujące dane — szybkie ostrzeżenia */}
                {(!hasVerification||!hasPhotos)&&(
                  <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginTop:6 }}>
                    {!hasVerification&&<span style={{ fontSize:10,padding:"2px 7px",borderRadius:10,background:"#fef2f2",color:"#dc2626",fontWeight:600 }}>⚠ brak podanych certyfikatów</span>}
                    {!hasPhotos&&<span style={{ fontSize:10,padding:"2px 7px",borderRadius:10,background:"#fef2f2",color:"#dc2626",fontWeight:600 }}>⚠ brak zdjęć produktu</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


function PageBuyerCatalog({ companies, offers, nav, sends, buyerRetailerId, role }) {
  const [search, setSearch]         = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCat, setFilterCat]   = useState("");
  const [previewCo, setPreviewCo]   = useState(null);

  const filtered = companies.filter(c => {
    if(search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if(filterCountry && c.country !== filterCountry) return false;
    if(filterCat && !(c.categories||[]).includes(filterCat)) return false;
    return true;
  });

  // For buyer: count only offers sent to their retailer
  const visibleOfferIds = role==="buyer" && buyerRetailerId
    ? new Set((sends||[]).filter(s=>s.retailerId===buyerRetailerId).map(s=>s.offerId))
    : null;

  const activeOffersCount = (co) => {
    if(visibleOfferIds !== null) {
      return offers.filter(o=>legacyKeyMatchesCompany(o.supplierId, co) && o.status==="active" && visibleOfferIds.has(o.id)).length;
    }
    return offers.filter(o=>legacyKeyMatchesCompany(o.supplierId, co) && o.status==="active").length;
  };

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#64748b",marginBottom:4 }}>Baza pomocnicza</div>
        <div style={{fontWeight:800,fontSize:22,marginBottom:4,color:"#0f172a",letterSpacing:-0.3}}>Dostawcy</div>
        <div style={{fontSize:13,color:"#64748b",lineHeight:1.5,maxWidth:680}}>
          Kompletna baza zweryfikowanych firm — certyfikaty, kraje, produkty i historia. <span style={{ color:"#94a3b8" }}>Po główne propozycje produktowe wróć do zakładki <strong>Propozycje asortymentowe</strong>.</span>
        </div>
        <div style={{fontSize:12,color:"#64748b",marginTop:10}}>
          {companies.length} zweryfikowanych firm · {companies.filter(c=>activeOffersCount(c)>0).length} ma aktywne propozycje
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Szukaj dostawcy..."
          style={{flex:1,minWidth:180,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit"}}/>
        <select value={filterCountry} onChange={e=>setFilterCountry(e.target.value)}
          style={{padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
          <option value="">Wszystkie kraje</option>
          {[...new Set(companies.map(c=>c.country))].sort().map(c=><option key={c} value={c}>{FLAGS[c]||"🌐"} {CNAMES[c]||c}</option>)}
        </select>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
          style={{padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
          <option value="">Wszystkie kategorie</option>
          <option value="owoce">🍎 Owoce</option>
          <option value="warzywa">🥕 Warzywa</option>
          <option value="kwiaty">🌸 Kwiaty</option>
        </select>
      </div>
      {filtered.length===0&&(
        <div style={{padding:40,textAlign:"center",color:"#94a3b8",background:"white",borderRadius:12,border:"1px solid #e2e8f0"}}>
          Brak dostawców spełniających kryteria.
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
        {filtered.map(co=>{
          const cnt=activeOffersCount(co);
          const initials=co.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
          return (
            <div key={co.id} style={{background:"white",border:"1px solid #e2e8f0",borderRadius:12,padding:18,display:"flex",flexDirection:"column",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:44,height:44,borderRadius:10,background:"linear-gradient(135deg,#0d9488,#0891b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:14,flexShrink:0}}>{initials}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{co.name}</div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{FLAGS[co.country]||"🌐"} {CNAMES[co.country]||co.country}{co.city?` · ${co.city}`:""}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {(co.categories||[]).map(cat=><span key={cat} style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(13,148,136,0.08)",color:"#0d9488",fontWeight:600}}>{CEMOJI[cat]} {cat}</span>)}
                {(co.types||[]).slice(0,2).map(t=><span key={t} style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"#f1f5f9",color:"#475569"}}>{TYPE_LABELS[t]||t}</span>)}
              </div>
              {co.products&&<div style={{fontSize:12,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{co.products}</div>}
              {(co.certs||[]).length>0&&(
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {(co.certs||[]).slice(0,3).map(cert=><span key={cert.type} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#fef3c7",color:"#92400e",fontWeight:600}}><Award size={9} style={{verticalAlign:"middle",marginRight:2}}/>{cert.type}</span>)}
                  {(co.certs||[]).length>3&&<span style={{fontSize:10,color:"#94a3b8"}}>+{co.certs.length-3}</span>}
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"auto",paddingTop:10,borderTop:"1px solid #f1f5f9"}}>
                <span style={{fontSize:11,color:cnt>0?"#059669":"#94a3b8",fontWeight:600}}>
                  {cnt>0?`${cnt} aktywn${cnt===1?"a":"e"} propozycj${cnt===1?"a":cnt<5?"e":"i"}` : "Brak propozycji"}
                </span>
                <button onClick={()=>setPreviewCo(co)} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:7,border:"none",background:"#0d9488",color:"white",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  <Eye size={12}/> Zobacz profil
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {previewCo&&<CompanyPreviewModal co={previewCo} offers={offers} sends={sends} buyerRetailerId={buyerRetailerId} role={role} onClose={()=>setPreviewCo(null)}/>}
    </div>
  );
}

function PageBuyerProfile({ buyer, setBuyer, fl }) {
  const [b,setB]=useState({...buyer}); const u=(k,v)=>setB(p=>({...p,[k]:v}));
  return (
    <div style={{ maxWidth:560 }}>
      <h2 style={{ marginBottom:16,fontSize:16 }}>Mój profil</h2>
      <Card title="Dane" icon={User}>
        <Row>
          <Inp label="Imię i nazwisko" required value={b.name} onChange={e=>u("name",e.target.value)}/>
          <Inp label="Stanowisko" value={b.position} onChange={e=>u("position",e.target.value)}/>
        </Row>
        <Row>
          <Inp label="Sieć handlowa" value={b.company} readOnly />
          <Inp label="Email (zmiana przez administratora)" type="email" value={b.email} readOnly />
        </Row>
        <Inp label="Telefon" value={b.phone} onChange={e=>u("phone",e.target.value)}/>
      </Card>
      <Card title="Subskrypcja mailingowa" icon={Mail}><div style={{ padding:12,background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}><label style={{ display:"flex",gap:10,cursor:"pointer" }}><input type="checkbox" checked={b.consent} onChange={e=>u("consent",e.target.checked)} style={{ width:16,height:16,marginTop:2 }}/><div><div style={{ fontWeight:600,fontSize:13,marginBottom:2 }}>Zgoda na mailing Preconnect</div><div style={{ fontSize:12,color:"#64748b" }}>Raz w miesiącu, w pierwszy wtorek. Zgodę można wycofać w każdej chwili.</div></div></label></div>{b.consent&&<div style={{ marginTop:8,padding:"7px 12px",background:"#d1fae5",borderRadius:7,fontSize:12,color:"#047857" }}>Subskrypcja aktywna · Następny mailing: 6 maja 2026</div>}</Card>
      <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:24 }}><Btn primary onClick={()=>{ setBuyer(b); fl("Profil zapisany."); }}>Zapisz</Btn></div>
      <ChangePasswordSection fl={fl}/>
    </div>
  );
}

// [B2B Round profile-supplier-self-edit] Strona "Mój profil" dla dostawcy.
// Pokazuje email (read-only), nazwę firmy (read-only), edytowalne pola:
// imię/nazwisko, telefon, stanowisko. Sekcja zmiany hasła (3 pola: aktualne,
// nowe, potwierdzenie nowego). Zapis przez dbUpdateOwnSupplierProfile -> RLS
// pozwala self-edit (profiles.id = auth.uid()).
function PageSupplierProfile({ account, co, fl }) {
  const initial = {
    name: account?.name || "",
    email: account?.email || "",
    phone: account?.phone || "",
    position: account?.position || "",
  };
  const [p, setP] = useState(initial);
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setP((prev) => ({ ...prev, [k]: v }));
  async function save() {
    if (!account?.id) { fl("Brak ID użytkownika — zaloguj się ponownie."); return; }
    if (!p.name?.trim()) { fl("Imię i nazwisko są wymagane."); return; }
    try {
      setSaving(true);
      await dbUpdateOwnSupplierProfile(account.id, {
        name: p.name, phone: p.phone, position: p.position,
      });
      fl("Profil zapisany.");
    } catch (e) {
      fl("Błąd zapisu: " + (e?.message || "nieznany"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ marginBottom: 16, fontSize: 16 }}>Mój profil</h2>
      <Card title="Dane konta" icon={User}>
        <Row>
          <Inp label="Imię i nazwisko" required value={p.name} onChange={(e) => u("name", e.target.value)} />
          <Inp label="Stanowisko" value={p.position} onChange={(e) => u("position", e.target.value)} />
        </Row>
        <Row>
          <Inp label="Firma" value={co?.name || account?.name || ""} readOnly />
          <Inp label="Email (zmiana przez administratora)" type="email" value={p.email} readOnly />
        </Row>
        <Inp label="Telefon" value={p.phone} onChange={(e) => u("phone", e.target.value)} />
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Email i dane firmy są zarządzane przez administratora Fresh Market. Możesz samodzielnie zmienić imię/nazwisko, stanowisko, telefon i hasło.
        </div>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
        <Btn primary onClick={save} disabled={saving}>{saving ? "Zapisywanie..." : "Zapisz"}</Btn>
      </div>
      <ChangePasswordSection fl={fl} />
    </div>
  );
}

// [B2B Round profile-self-password-change] Wspólna sekcja zmiany hasła dla
// dostawcy i kupca. 3 pola: aktualne, nowe (min 8 zn.), potwierdzenie.
// Walidacja:
//   - aktualne hasło niewidoczne, sprawdzane przez signInWithPassword (re-auth)
//   - nowe hasło min 8 znaków, musi być zgodne z potwierdzeniem
//   - po sukcesie pola resetowane, flash potwierdzenia
function ChangePasswordSection({ fl }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNw, setShowNw] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!cur || !nw || !cf) { fl("Wypełnij wszystkie pola."); return; }
    if (nw.length < 8) { fl("Nowe hasło musi mieć minimum 8 znaków."); return; }
    if (nw !== cf) { fl("Nowe hasło i potwierdzenie nie są takie same."); return; }
    try {
      setBusy(true);
      await dbChangeOwnPassword(cur, nw);
      setCur(""); setNw(""); setCf("");
      fl("Hasło zmienione pomyślnie.");
    } catch (e) {
      fl("Błąd: " + (e?.message || "nie udało się zmienić hasła"));
    } finally {
      setBusy(false);
    }
  }

  const InputPwd = ({ label, value, onChange, show, setShow }) => (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <Inp label={label} type={show ? "text" : "password"} value={value} onChange={onChange} />
      <button
        type="button"
        onClick={() => setShow(!show)}
        title={show ? "Ukryj hasło" : "Pokaż hasło"}
        style={{ position: "absolute", right: 8, top: 26, padding: "4px 8px", background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontSize: 11 }}
      >
        {show ? "ukryj" : "pokaż"}
      </button>
    </div>
  );

  return (
    <Card title="Zmiana hasła" icon={Lock}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Wpisz aktualne hasło i nowe (minimum 8 znaków). Po zmianie nadal będziesz zalogowany na tym urządzeniu.
      </div>
      <InputPwd label="Aktualne hasło" value={cur} onChange={(e) => setCur(e.target.value)} show={showCur} setShow={setShowCur} />
      <Row>
        <InputPwd label="Nowe hasło (min 8 znaków)" value={nw} onChange={(e) => setNw(e.target.value)} show={showNw} setShow={setShowNw} />
        <Inp label="Powtórz nowe hasło" type={showNw ? "text" : "password"} value={cf} onChange={(e) => setCf(e.target.value)} />
      </Row>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, marginBottom: 24 }}>
        <Btn primary onClick={submit} disabled={busy}>{busy ? "Zmienianie..." : "Zmień hasło"}</Btn>
      </div>
    </Card>
  );
}

function PageBuyerDetail({ send, offers, co, nav, buyer, toggleStar, companies, buyerRetailerId, sends, onOpened }) {
  const supplierCo = getSupplierCo(send, offers, companies) || co || COMPANY_INIT;
  const [showCoModal, setShowCoModal] = useState(false);
  // [B2B Round 5.3] First time buyer opens this detail: flip status sent -> read
  // via SECURITY DEFINER RPC (markSendOpened in App). Pass the WHOLE send
  // object — not just id — so markSendOpened doesn't need to do a stale
  // sends.find() lookup that may race with hydration.
  const sendId = send?.id;
  const sendStatus = send?.status;
  useEffect(() => {
    if (!send || send.status !== "sent" || typeof onOpened !== "function") return;
    onOpened(send);
  }, [sendId, sendStatus, onOpened]); // eslint-disable-line react-hooks/exhaustive-deps
  if(!send) return <div><Btn outline onClick={()=>nav("b-offers")}><ArrowLeft size={13}/> Wróć</Btn></div>;
  const o=getOffer(send.offerId,offers); if(!o) return null;
  const allCerts=[...(o.certs||[]),o.customCert].filter(Boolean);
  const allPack=[...(o.packaging||[]),o.customPackaging].filter(Boolean);
  const isStarred=(buyer.starred||[]).includes(o.id);
  const vol = o.volumeMin&&o.volumeMax ? `${o.volumeMin}–${o.volumeMax} ${o.volumeUnit||""}` : o.volume ? `${o.volume} ${o.volumeUnit||""}` : "—";

  /* helper: sekcja z opcjonalnym rozwinięciem */
  function Sec({label,icon,color="#0d9488",bg="#f0fdfa",children,defaultOpen=true}){
    const [open,setOpen]=useState(defaultOpen);
    return(
      <div style={{ marginBottom:12,border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden" }}>
        <div onClick={()=>setOpen(x=>!x)} style={{ padding:"9px 14px",background:bg,borderBottom:open?"1px solid #e2e8f0":"none",display:"flex",gap:7,alignItems:"center",cursor:"pointer",userSelect:"none" }}>
          <span style={{ fontSize:13 }}>{icon}</span>
          <span style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color,flex:1 }}>{label}</span>
          <span style={{ fontSize:12,color:"#94a3b8" }}>{open?"▲":"▼"}</span>
        </div>
        {open&&<div style={{ padding:"12px 14px",background:"white" }}>{children}</div>}
      </div>
    );
  }
  function KV({items}){
    const filtered=items.filter(([,v])=>v!=null&&v!=="");
    if(!filtered.length) return null;
    return(
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8 }}>
        {filtered.map(([l,v])=>(
          <div key={l} style={{ padding:"8px 10px",background:"#f8fafc",borderRadius:7,border:"1px solid #e2e8f0" }}>
            <div style={{ fontSize:9,color:"#94a3b8",textTransform:"uppercase",marginBottom:2 }}>{l}</div>
            <div style={{ fontWeight:600,fontSize:12,color:"#1e293b" }}>{v}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth:960 }}>
      {/* Top bar */}
      <div style={{ marginBottom:14,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
        <Btn outline sm onClick={()=>nav("b-offers")}><ArrowLeft size={13}/> Wróć do propozycji</Btn>
        <label style={{ display:"flex",alignItems:"center",gap:7,padding:"6px 12px",background:isStarred?"#f0fdf4":"#f8fafc",border:`1.5px solid ${isStarred?"#059669":"#e2e8f0"}`,borderRadius:8,cursor:"pointer",userSelect:"none" }}>
          <input type="checkbox" checked={isStarred} onChange={()=>toggleStar(o.id)} style={{ width:15,height:15,cursor:"pointer",accentColor:"#059669" }}/>
          <span style={{ fontSize:13,fontWeight:isStarred?600:400,color:isStarred?"#059669":"#64748b" }}>{isStarred?"Zapisana ✓":"Zapisz propozycję"}</span>
        </label>
      </div>


      {/* Header hero */}
      <div style={{ background:"linear-gradient(135deg,#f0fdf4,#ecfdf5)",borderRadius:12,padding:16,marginBottom:14,display:"flex",gap:14 }}>
        {(o.photos||[]).length>0
          ? <div style={{ position:"relative",flexShrink:0 }}>
              <img src={o.photos[0]} alt="" style={{ width:140,height:105,objectFit:"cover",borderRadius:8,border:"2px solid #bbf7d0" }}/>
              {(o.photos||[]).length>1 && (
                <span style={{ position:"absolute",bottom:5,right:5,background:"rgba(15,23,42,0.78)",color:"white",fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:12 }}>+{o.photos.length-1}</span>
              )}
            </div>
          : <div style={{ width:140,height:105,borderRadius:8,background:"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:42 }}>{CEMOJI[o.category]||"📦"}</div>
        }
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:6 }}>
            {allCerts.map(c=><Badge key={c} color="#0d9488">{c}</Badge>)}
            {o.origin&&<Badge>{FLAGS[o.origin]||"🌐"} {CNAMES[o.origin]||o.origin}</Badge>}
            {o.positioning&&<Badge color="#7c3aed" bg="#faf5ff">{o.positioning}</Badge>}
            {o.offerType&&<Badge color="#2563eb" bg="#eff6ff">{o.offerType}</Badge>}
            {o.isBio&&<Badge color="#059669" bg="#ecfdf5">🌿 Bio</Badge>}
          </div>
          <div style={{ fontWeight:700,fontSize:16,color:"#0f172a",marginBottom:8 }}>{o.title||o.product}</div>
          <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>
            {[["Wolumen",vol],["Min. zamówienie",o.moq||o.minOrder],["Czas realizacji",o.leadTime],["Sezon",o.from&&o.to?`${o.from} – ${o.to}`:null]].map(([l,v])=>v&&<div key={l} style={{ textAlign:"center",padding:"5px 10px",background:"white",borderRadius:7,border:"1px solid #bbf7d0" }}><div style={{ fontSize:9,color:"#94a3b8",textTransform:"uppercase" }}>{l}</div><div style={{ fontWeight:700,fontSize:12,color:"#0d9488" }}>{v}</div></div>)}
          </div>
        </div>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 300px",gap:14,alignItems:"start" }}>
        {/* LEFT — wszystkie sekcje oferty */}
        <div>

          {/* Identyfikacja */}
          <Sec label="Identyfikacja produktu" icon="🎯" defaultOpen={true}>
            <KV items={[["Nazwa",o.product],["Odmiana",o.variety],["Kategoria",o.category],["Podkategoria",o.subcategory],["Kraj",o.origin?`${FLAGS[o.origin]||"🌐"} ${CNAMES[o.origin]||o.origin}`:null],["Region",o.region],["Typ propozycji",o.offerType],["Pozycjonowanie",o.positioning]]}/>
          </Sec>

          {/* Co Cię wyróżnia — przeniesione tuż pod Identyfikację, otwarte domyślnie */}
          {(o.benefit1||o.benefit2||o.benefit3||o.shopBenefit)&&(
            <Sec label="Co wyróżnia tego dostawcę?" icon="✅" color="#059669" bg="#f0fdf4" defaultOpen={true}>
              <div style={{ display:"flex",flexDirection:"column",gap:7,marginBottom:o.shopBenefit?10:0 }}>
                {[o.benefit1,o.benefit2,o.benefit3].filter(Boolean).map((b,i)=>(
                  <div key={i} style={{ display:"flex",gap:9,alignItems:"flex-start" }}>
                    <div style={{ width:20,height:20,borderRadius:"50%",background:"#059669",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,flexShrink:0,marginTop:1 }}>{i+1}</div>
                    <div style={{ fontSize:13,color:"#1e293b",lineHeight:1.55 }}>{b}</div>
                  </div>
                ))}
              </div>
              {o.shopBenefit&&<div style={{ padding:"10px 12px",background:"#dcfce7",borderRadius:7,fontSize:13,color:"#065f46",lineHeight:1.65,border:"1px solid #bbf7d0" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#047857",textTransform:"uppercase",marginBottom:3 }}>Jak pomaga sprzedaży w sklepie</div>
                {o.shopBenefit}
              </div>}
            </Sec>
          )}

          {/* Zdjęcia produktu — accordion, domyślnie zamknięty, pełen podgląd po rozwinięciu */}
          {(o.photos||[]).length>0 && (
            <Sec label={`Zdjęcia produktu (${o.photos.length})`} icon="📸" color="#0d9488" bg="#f0fdfa" defaultOpen={false}>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:12 }}>
                {o.photos.map((p,i)=>(
                  <a key={i} href={p} target="_blank" rel="noreferrer" style={{
                    display:"block",
                    background:"#f8fafc",
                    border:"1px solid #e2e8f0",
                    borderRadius:10,
                    overflow:"hidden",
                    aspectRatio:"4 / 3",
                    cursor:"zoom-in",
                    position:"relative",
                  }}>
                    <img src={p} alt={`Zdjęcie ${i+1}`} loading="lazy" style={{
                      width:"100%",
                      height:"100%",
                      objectFit:"contain",
                      background:"white",
                    }}/>
                    <span style={{
                      position:"absolute",
                      bottom:6, left:6,
                      background:"rgba(15,23,42,0.75)",
                      color:"white",
                      fontSize:10,
                      fontWeight:600,
                      padding:"2px 8px",
                      borderRadius:10,
                    }}>{i===0 ? "Główne" : `Zdjęcie ${i+1}`}</span>
                  </a>
                ))}
              </div>
              <div style={{ fontSize:11,color:"#64748b",marginTop:10 }}>Kliknij zdjęcie, by otworzyć w pełnym rozmiarze.</div>
            </Sec>
          )}

          {/* Specyfikacja jakościowa */}
          <Sec label="Specyfikacja jakościowa" icon="📊" color="#2563eb" bg="#eff6ff" defaultOpen={false}>
            <KV items={[["Kaliber / rozmiar",o.size],["Klasa jakości",o.qualityClass],["Marka / brand",o.brand],["Tryb sprzedaży",o.saleMode],["Brix",o.brix],["Kolor / wybarwienie",o.colorSpec],["Bio / Organic",o.isBio?"Tak":null]]}/>
            {o.qualitySpec&&<div style={{ marginTop:10,padding:"10px 12px",background:"#f8fafc",borderRadius:7,fontSize:13,color:"#334155",lineHeight:1.65,border:"1px solid #e2e8f0" }}>{o.qualitySpec}</div>}
          </Sec>

          {/* Kwiaty */}
          {(o.stemLength||o.vaseLife||o.bouquetCount)&&(
            <Sec label="Parametry kwiatowe" icon="🌸" color="#7c3aed" bg="#faf5ff" defaultOpen={false}>
              <KV items={[["Długość pędu",o.stemLength],["Faza otwarcia",o.openingPhase],["Szt. w bukiecie",o.bouquetCount],["Vase life",o.vaseLife],["Kolor / mix",o.flowerColor]]}/>
            </Sec>
          )}

          {/* Dostępność i wolumen */}
          <Sec label="Dostępność i wolumen" icon="📅" defaultOpen={false}>
            <KV items={[["Dostępność od",o.from],["Dostępność do",o.to],["Model dostępności",o.availabilityModel],["Wolumen min.",o.volumeMin?`${o.volumeMin} ${o.volumeUnit||""}`:null],["Wolumen maks.",o.volumeMax?`${o.volumeMax} ${o.volumeUnit||""}`:null],["Min. zamówienie",o.moq||o.minOrder],["Czas realizacji",o.leadTime],["Promo +%",o.promoVolumePct||o.promoVolume]]}/>
            {(o.deliveryDays||[]).length>0&&<div style={{ marginTop:8,display:"flex",gap:5,flexWrap:"wrap" }}>{(o.deliveryDays||[]).map(d=><Badge key={d} color="#0d9488">{d}</Badge>)}</div>}
          </Sec>

          {/* Opakowanie */}
          <Sec label="Opakowanie i paletyzacja" icon="📦" color="#d97706" bg="#fffbeb" defaultOpen={false}>
            {allPack.length>0&&<div style={{ marginBottom:10,display:"flex",gap:5,flexWrap:"wrap" }}>{allPack.map(p=><Badge key={p} color="#d97706" bg="#fef3c7">{p}</Badge>)}</div>}
            <KV items={[["Opis opakowania",o.packagingDesc],["Typ palety",o.palletType],["Wys. palety",o.palletHeight],["Kartony/warstwę",o.cartonsPerLayer],["Warstwy/paletę",o.layersPerPallet],["Jedn./paletę",o.unitsPerPallet],["Shelf-ready (SRP)",o.srp]]}/>
          </Sec>

          {/* Logistyka */}
          <Sec label="Logistyka i reklamacje" icon="🚛" color="#1d4ed8" bg="#eff6ff" defaultOpen={false}>
            <KV items={[["Model dostawy",o.deliveryModel],["Miejsce załadunku",o.loadingPoint],["Regiony dostaw",o.deliveryRegions],["Organizacja transportu",o.coldChain],["Temperatura",o.tempTransport]]}/>
          </Sec>

          {/* Certyfikaty */}
          {(allCerts.length>0||o.traceability||o.certNumber)&&(
            <Sec label="Certyfikaty i identyfikowalność" icon="🛡️" color="#059669" bg="#f0fdf4" defaultOpen={false}>
              <KV items={[["Identyfikowalność",o.traceability],["Numer certyfikatu",o.certNumber],["Ważny do",o.certValid],["Aktualne badania",o.currentTests]]}/>
              {allCerts.length>0&&<div style={{ marginTop:8,display:"flex",gap:5,flexWrap:"wrap" }}>{allCerts.map(c=><Badge key={c} color="#059669">{c}</Badge>)}</div>}
            </Sec>
          )}

          {/* Warunki handlowe */}
          {(o.priceOffer||o.incoterm||o.samplesAvail||o.promoPrice||o.contractProgram)&&(
            <Sec label="Cena orientacyjna i warunki handlowe" icon="💰" color="#d97706" bg="#fffbeb" defaultOpen={false}>
              {o.priceOffer&&<div style={{ marginBottom:10,padding:"12px 14px",background:"#fef3c7",borderRadius:8,border:"1px solid #fde68a" }}>
                <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:6 }}>
                  <div style={{ fontWeight:700,fontSize:18,color:"#92400e" }}>{o.priceOffer} {o.currency||"EUR"}/{o.priceUnit||"kg"}</div>
                  <Badge color="#d97706" bg="#fffbeb">Cena orientacyjna</Badge>
                  {o.incoterm&&<Badge color="#d97706" bg="#fffbeb">{o.incoterm}</Badge>}
                  {o.priceFrom&&o.priceTo&&<span style={{ fontSize:11,color:"#92400e" }}>Aktualna: {o.priceFrom} – {o.priceTo}</span>}
                </div>
                <div style={{ fontSize:11,color:"#a16207",fontStyle:"italic",lineHeight:1.5 }}>
                  ⓘ Cena ma charakter orientacyjny i wymaga potwierdzenia z dostawcą. Aktualną cenę i warunki otrzymasz po kontakcie.
                </div>
              </div>}
              <KV items={[["Cena promo możliwa",o.promoPrice],["Program kontraktowy",o.contractProgram],["Próbki",o.samplesAvail]]}/>
            </Sec>
          )}

          {/* Bezpieczeństwo współpracy */}
          {(o.riskMitigation||o.riskProof||o.riskNow)&&(
            <Sec label="Bezpieczeństwo współpracy" icon="🔒" color="#dc2626" bg="#fef2f2" defaultOpen={false}>
              {o.riskMitigation&&<div style={{ marginBottom:8,padding:"10px 12px",background:"#fff",borderRadius:7,fontSize:13,color:"#1e293b",lineHeight:1.65,border:"1px solid #fca5a5" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#dc2626",textTransform:"uppercase",marginBottom:3 }}>Jak dostawca zabezpiecza współpracę</div>
                {o.riskMitigation}
              </div>}
              {o.riskProof&&<div style={{ marginBottom:8,padding:"10px 12px",background:"#fff",borderRadius:7,fontSize:13,color:"#1e293b",lineHeight:1.65,border:"1px solid #e2e8f0" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:3 }}>Potwierdzenie wiarygodności</div>
                {o.riskProof}
              </div>}
              {o.riskNow&&<div style={{ padding:"10px 12px",background:"#fffbeb",borderRadius:7,fontSize:13,color:"#92400e",lineHeight:1.65,border:"1px solid #fde68a" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#d97706",textTransform:"uppercase",marginBottom:3 }}>Dlaczego teraz?</div>
                {o.riskNow}
              </div>}
            </Sec>
          )}

          {/* Fallback stary opis */}
          {!o.benefit1&&!o.qualitySpec&&o.description&&(
            <Sec label="Opis propozycji" icon="📝" defaultOpen>
              <p style={{ color:"#475569",lineHeight:1.7,margin:0,fontSize:13,whiteSpace:"pre-line" }}>{renderDesc(o.description)}</p>
            </Sec>
          )}

          {/* CTA — możliwe akcje kupca (zawsze widoczne, pełna lista CTA_MAP) */}
          <div style={{ padding:16,background:"linear-gradient(135deg,#f0fdf4,#dcfce7)",border:"1px solid #bbf7d0",borderRadius:10,marginBottom:12 }}>
            <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:"#047857",marginBottom:6 }}>Możliwe działania</div>
            <div style={{ fontSize:12,color:"#475569",marginBottom:10 }}>Skontaktuj się z dostawcą — możesz poprosić o próbkę, zapytać o aktualną cenę, poprosić o specyfikację lub umówić rozmowę.</div>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              {Object.entries(CTA_MAP).map(([key,label],i)=>{
                const ctaLabel=label;
                const supplierEmail=(supplierCo?.contacts?.[0]?.email)||"";
                const subjectMap={
                  samples:`Preconnect – prośba o próbkę: ${o.title||o.product}`,
                  spec:`Preconnect – prośba o specyfikację: ${o.title||o.product}`,
                  rfq:`Preconnect – zapytanie o cenę i wolumen: ${o.title||o.product}`,
                  call:`Preconnect – prośba o rozmowę: ${o.title||o.product}`,
                  long_term:`Preconnect – program sezonowy: ${o.title||o.product}`,
                  meet_fm:`Preconnect – spotkanie Fresh Market 2026: ${o.title||o.product}`,
                };
                const bodyMap={
                  samples:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" chciałbym/chciałabym poprosić o przesłanie próbki produktu.\n\nProszę o kontakt w celu uzgodnienia szczegółów.\n\nPozdrawiam`,
                  spec:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" proszę o przesłanie pełnej specyfikacji technicznej i dokumentacji jakościowej.\n\nPozdrawiam`,
                  rfq:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" chciałbym/chciałabym zapytać o aktualną cenę i dostępne wolumeny.\n\nProszę o przesłanie aktualnej ceny, dostępnych wolumenów oraz warunków dostawy.\n\nPozdrawiam`,
                  call:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" chciałbym/chciałabym umówić rozmowę telefoniczną.\n\nCzy mogą mi Państwo zaproponować termin?\n\nPozdrawiam`,
                  long_term:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" chciałbym/chciałabym zapytać o możliwość uruchomienia programu sezonowego / kontraktu długoterminowego.\n\nProszę o kontakt w celu omówienia szczegółów.\n\nPozdrawiam`,
                  meet_fm:`Dzień dobry,\n\nW związku z propozycją Preconnect na Fresh Market 2026 pt. "${o.title||o.product}" chciałbym/chciałabym umówić spotkanie podczas targów Fresh Market 2026 (24 września, Ożarów Mazowiecki).\n\nCzy jest taka możliwość?\n\nPozdrawiam`,
                };
                const mailto=`mailto:${supplierEmail}?subject=${encodeURIComponent(subjectMap[key]||"Preconnect – zapytanie")}&body=${encodeURIComponent(bodyMap[key]||"")}`;
                return (
                  <a key={key} href={mailto} style={{ background:i===0?"#0d9488":"white",color:i===0?"white":"#0d9488",border:i===0?"none":"2px solid #0d9488",padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6 }}>
                    <Mail size={13}/>{ctaLabel}
                  </a>
                  );
                })}
              </div>
            </div>
        </div>

        {/* RIGHT — dostawca + kontakt */}
        <div>
          <Card title="Dostawca" icon={Building2}>
            {(() => {
              const supCerts = (supplierCo?.certs||[]).length>0;
              const initials = (supplierCo?.name||"FM").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
              return <>
                <div style={{ display:"flex",gap:10,alignItems:"flex-start",marginBottom:10 }}>
                  <div style={{ width:48,height:48,borderRadius:10,background:supplierCo?.logo?"white":"linear-gradient(135deg,#1e3a5f,#0d9488)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,color:"white",flexShrink:0,letterSpacing:-0.5,boxShadow:"0 2px 6px rgba(15,23,42,0.08)",border:supplierCo?.logo?"1px solid #e2e8f0":"none",overflow:"hidden" }}>
                    {supplierCo?.logo
                      ? <img src={supplierCo.logo} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/>
                      : initials}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:800,fontSize:14,marginBottom:2,color:"#0f172a" }}>{supplierCo?.name}</div>
                    <div style={{ fontSize:11,color:"#64748b" }}>{FLAGS[supplierCo?.country]||"🌐"} {CNAMES[supplierCo?.country]||supplierCo?.country} · {supplierCo?.city}</div>
                  </div>
                </div>
                <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:8 }}>
                  {supCerts
                    ? <Badge color="#059669" bg="#ecfdf5"><CheckCircle size={9} style={{ verticalAlign:"middle",marginRight:2 }}/> Certyfikaty podane</Badge>
                    : <Badge color="#dc2626" bg="#fef2f2"><AlertTriangle size={9} style={{ verticalAlign:"middle",marginRight:2 }}/> Brak podanych certyfikatów</Badge>
                  }
                  {(supplierCo?.types||[]).map(t=><Badge key={t} color="#0d9488">{TYPE_LABELS[t]||t}</Badge>)}
                </div>
                <button onClick={()=>setShowCoModal(true)} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:7,border:"1px solid #0d9488",background:"rgba(13,148,136,0.06)",color:"#0d9488",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  <Eye size={12}/> Pełny profil dostawcy
                </button>
              </>;
            })()}
          </Card>
          <Card title="Kontakt z dostawcą" icon={Phone}>
            <div style={{ marginBottom:8,padding:"6px 10px",background:"#f0fdf4",borderRadius:6,fontSize:11,color:"#047857",border:"1px solid #bbf7d0" }}>Możesz kontaktować się bezpośrednio</div>
            {(supplierCo.contacts||[]).map((ct,i)=>(
              <div key={i} style={{ padding:"9px 12px",background:"#f8fafc",borderRadius:8,marginBottom:6,border:"1px solid #e2e8f0" }}>
                <div style={{ fontWeight:600,fontSize:13,marginBottom:2 }}>{ct.name}</div>
                <div style={{ fontSize:11,color:"#64748b",marginBottom:5 }}>{ct.position}</div>
                <a href={`tel:${ct.phone}`} style={{ fontSize:12,color:"#1e293b",textDecoration:"none",display:"flex",gap:5,alignItems:"center",marginBottom:3 }}><Phone size={12} color="#0d9488"/>{ct.phone}</a>
                <a href={`mailto:${ct.email}`} style={{ fontSize:12,color:"#2563eb",textDecoration:"none",display:"flex",gap:5,alignItems:"center" }}><Mail size={12} color="#2563eb"/>{ct.email}</a>
              </div>
            ))}
          </Card>

        </div>
      </div>
      {showCoModal && <CompanyPreviewModal co={supplierCo} offers={offers} sends={sends} buyerRetailerId={buyerRetailerId} role="buyer" onClose={()=>setShowCoModal(false)}/>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ADMIN PAGES – 4 items
══════════════════════════════════════════════════════════════════════════ */

/* ── Admin Dashboard ──────────────────────────────────────────────────── */
function PageAdminDash({ sends, nav, fmSettings, fmPrefs, fmResps, fmSchedule, resetToSeed, retailers, fmSuppliers }) {
  const pm=sends.filter(s=>s.status==="pending_moderation").length;
  const ap=sends.filter(s=>s.status==="approved").length;
  const nc=sends.filter(s=>s.status==="sent").length;
  const confirmed=sends.filter(s=>["read","read_manual"].includes(s.status));
  const revenue=confirmed.length*40;
  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:20 }}>
        {[["Przychód (potwier.)",`${revenue} EUR`,revenue>0?"#059669":"#94a3b8",TrendingUp],[`Do moderacji (${pm})`,pm>0?"Wymaga akcji":"OK",pm>0?"#d97706":"#059669",Layers],[`Zatwierdzone (${ap})`,ap>0?"Gotowe do wysyłki":"—",ap>0?"#2563eb":"#94a3b8",Send],[`Do potwierdzenia (${nc})`,nc>0?"Tracking aktywny":"—",nc>0?"#ea580c":"#94a3b8",Phone]].map(([l,v,c,Ic])=>(
          <div key={l} style={{ padding:"14px 16px",background:"white",border:"1px solid #e2e8f0",borderRadius:12,borderTop:`3px solid ${c}` }}>
            <div style={{ display:"flex",gap:6,alignItems:"center",marginBottom:6,color:"#64748b",fontSize:11 }}><Ic size={12} color={c}/>{l}</div>
            <div style={{ fontSize:14,fontWeight:700,color:c }}>{v}</div>
          </div>
        ))}
      </div>
      {fmSettings && (()=>{
        const _ph = FM_PHASES[(fmSettings.currentPhase||1)-1];
        const _suppliers = fmSuppliers || FM_SUPPLIERS;
        const _sr = _suppliers.filter(s=>Object.values(fmPrefs[s.id]||{}).filter(v=>v==="star").length>=5).length;
        // FM chains: use fm26ChainId for fmResps lookup (keys are chX, not numeric retailer IDs)
        const _fmRetailers = (retailers||[]).filter(r => r.fm26Active && r.active!==false && r.fm26ChainId);
        const _cr = _fmRetailers.filter(r => Object.values(fmResps[r.fm26ChainId]||{}).some(hasBuyerResponse)).length;
        const _mt = fmSchedule ? Object.values(fmSchedule.res||{}).reduce((a,r)=>a+r.m.length,0) : 0;
        return (
          <div onClick={()=>nav("a-fm")} style={{ cursor:"pointer",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:12,padding:"16px 20px",marginBottom:16,display:"flex",gap:14,alignItems:"center",flexWrap:"wrap" }}>
            <div style={{ flex:1,minWidth:180 }}>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4 }}>Fresh Market 2026 — Status</div>
              <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:3 }}>
                <div style={{ width:7,height:7,borderRadius:"50%",background:_ph.color }}/>
                <span style={{ color:"white",fontWeight:700,fontSize:13 }}>{_ph.label}</span>
                <span style={{ color:"rgba(255,255,255,0.45)",fontSize:11 }}>— {_ph.sub}</span>
                {!fmSettings.schedulingOpen&&<span style={{ fontSize:10,padding:"2px 7px",borderRadius:6,background:"rgba(220,38,38,0.2)",color:"#fca5a5" }}>🔴 Zamknięta</span>}
                {fmSettings.schedulingOpen&&<span style={{ fontSize:10,padding:"2px 7px",borderRadius:6,background:"rgba(5,150,105,0.2)",color:"#6ee7b7" }}>🟢 Otwarta</span>}
              </div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.25)" }}>{_ph.dates} · kliknij aby zarządzać →</div>
            </div>
            <div style={{ display:"flex",gap:8 }}>
              {[[_sr+"/"+_suppliers.length,"Dostawców","rgba(255,255,255,0.07)","#6ee7b7"],[_cr+"/"+_fmRetailers.length,"Sieci","rgba(255,255,255,0.07)","#93c5fd"],[_mt,"Spotkań","rgba(5,150,105,0.18)","#6ee7b7"]].map(([v,l,bg,c])=>(
                <div key={l} style={{ padding:"8px 12px",background:bg,borderRadius:8,textAlign:"center",minWidth:60 }}>
                  <div style={{ fontSize:15,fontWeight:800,color:c }}>{v}</div>
                  <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",marginTop:1 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
        {[["a-pipeline",Layers,"Pipeline","Moderacja, wysyłka, potwierdzenia 14 dni"],["a-retailers",Store,"Sieci","Kontakty kupców i harmonogram wysyłek"],["a-firmy",Building2,"Firmy","Pakiety, limity, rozliczenia per firma"]].map(([p,Ic,t,d])=>(
          <div key={p} onClick={()=>nav(p)} style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:10,padding:16,cursor:"pointer" }}>
            <div style={{ display:"flex",gap:7,alignItems:"center",marginBottom:5 }}><Ic size={14} color="#0d9488"/><strong style={{ fontSize:13 }}>{t}</strong></div>
            <div style={{ fontSize:12,color:"#64748b" }}>{d}</div>
          </div>
        ))}
      </div>
      {resetToSeed&&(
        <div style={{ borderTop:"1px solid #e2e8f0",paddingTop:14,display:"flex",alignItems:"center",gap:10 }}>
          <Btn outline sm onClick={resetToSeed} style={{ color:"#dc2626",borderColor:"#fca5a5",display:"flex",alignItems:"center",gap:5 }}>
            <RotateCcw size={12}/> Reset danych testowych
          </Btn>
          <span style={{ fontSize:11,color:"#94a3b8" }}>Przywraca domyślne propozycje, wysyłki i dane FM. Czyści localStorage.</span>
        </div>
      )}
    </div>
  );
}

/* ── Admin Pipeline: tabs Moderacja / Wysłane+Tracking ──────────────────── */
function PageAdminPipeline({ sends, setSends, offers, moderate, sendApproved, updateSendDate, updateSendPos, confirmManual, undoConfirm, fl, retailers, companies }) {
  function getRetailerLive(id) {
    return (retailers||[]).find(r=>r.id===id) || null;
  }
  const [tab,setTab]=useState("mod");
  const modSends=sends.filter(s=>["pending_moderation","approved","queued"].includes(s.status));
const [expandedRetailers, setExpandedRetailers] = useState(() => {
    const withPending = modSends
      .filter(s => s.status === "pending_moderation")
      .map(s => s.retailerId);
    return new Set(withPending);
  });
  function toggleExpand(rid) {
    setExpandedRetailers(prev => { const n = new Set(prev); n.has(rid)?n.delete(rid):n.add(rid); return n; });
  }
  const [previewOffer,setPreviewOffer]=useState(null);
  const [historyId,setHistoryId]=useState(null);
  const [emailPreview,setEmailPreview]=useState(null); // { retailerId, sends[] }

    const sentSends=sends.filter(s=>["sent","read","read_manual"].includes(s.status));
  const ap=sends.filter(s=>s.status==="approved").length;

  // Group mod by retailer
  const byR={};
  modSends.forEach(s=>{ if(!byR[s.retailerId]) byR[s.retailerId]=[]; byR[s.retailerId].push(s); });
  Object.keys(byR).forEach(k=>{ byR[k].sort((a,b)=>(a.pos||99)-(b.pos||99)); });

  const histSend=historyId?sends.find(s=>s.id===historyId):null;

  return (
    <div>
      {previewOffer&&<OfferPreviewModal offer={previewOffer} co={(companies||[]).find(c=>c.id===previewOffer?.supplierId)||COMPANY_INIT} onClose={()=>setPreviewOffer(null)}/>}
      {emailPreview&&<EmailNewsletterModal
        retailer={emailPreview.retailer}
        sends={emailPreview.sends}
        offers={offers}
        companies={companies}
        fl={fl}
        onClose={()=>setEmailPreview(null)}
        onSent={(markedIds, sentAt) => {
          // Round pipeline-retailer-email-mvp: po sukcesie aktualizujemy
          // lokalny state — pipelina przeładuje wybór i pozycje wysłanych
          // przejdą do statusu "sent". setSends sam zsync'uje DB przez
          // bulkUpsertLegacySends (ale i tak backend już to zrobił).
          if (!markedIds || !markedIds.length) return;
          const idSet = new Set(markedIds.map(Number));
          setSends?.(prev => prev.map(s => idSet.has(Number(s.id))
            ? { ...s, status: "sent", sentAt, daysLeft: 14 }
            : s
          ));
        }}
      />}
      {histSend&&<Modal title={`Historia: ${getOffer(histSend.offerId,offers)?.product}`} onClose={()=>setHistoryId(null)}>
        {(histSend.confirmHistory||[]).length===0?<div style={{ color:"#94a3b8",textAlign:"center",padding:16 }}>Brak historii.</div>:(histSend.confirmHistory||[]).map((h,i)=>(
          <div key={i} style={{ display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9" }}>
            <div style={{ width:26,height:26,borderRadius:"50%",background:h.action==="confirm"?"#d1fae5":"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>{h.action==="confirm"?<CheckCircle size={12} color="#059669"/>:<RotateCcw size={12} color="#dc2626"/>}</div>
            <div style={{ flex:1 }}><div style={{ fontWeight:600,fontSize:12 }}>{h.action==="confirm"?"Potwierdzono":"Cofnięto"}</div>{h.type&&<div style={{ fontSize:11,color:"#64748b" }}>{h.type}</div>}{h.note&&<div style={{ fontSize:11,color:"#64748b" }}>{h.note}</div>}<div style={{ fontSize:10,color:"#94a3b8" }}>{h.at}</div></div>
          </div>
        ))}
      </Modal>}

      {/* Tab bar */}
      <div style={{ display:"flex",gap:4,marginBottom:16,background:"#f1f5f9",borderRadius:10,padding:4,width:"fit-content" }}>
        {[["mod",`Moderacja (${modSends.length})`],["track",`Wysłane & Tracking (${sentSends.length})`]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"7px 16px",borderRadius:8,border:"none",background:tab===t?"white":"transparent",fontWeight:tab===t?600:400,fontSize:12,cursor:"pointer",fontFamily:"inherit",color:tab===t?"#1e293b":"#64748b",boxShadow:tab===t?"0 1px 3px rgba(0,0,0,0.08)":"none",whiteSpace:"nowrap" }}>{l}</button>
        ))}
      </div>

      {/* MODERACJA TAB */}
      {tab==="mod"&&<>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
          <div style={{ fontSize:12,color:"#64748b" }}>Edytuj pozycję (nr 1 = na górze u kupca). Wysyłka: <strong>6 maja 2026 (wt.)</strong></div>
          <Btn primary onClick={sendApproved} disabled={ap===0} style={{ background:ap>0?"#059669":"#94a3b8" }}><Send size={13}/> Wyślij zatwierdzone ({ap})</Btn>
        </div>
        {sends.some(s=>s.status==="pending_moderation")&&<Alrt type="warning"><strong>{sends.filter(s=>s.status==="pending_moderation").length}</strong> propozycji czeka na moderację.</Alrt>}
        {Object.keys(byR).length===0&&<Alrt>Brak propozycji w kolejkach.</Alrt>}
        {Object.entries(byR).map(([rid,ss])=>{
          const r=getRetailerLive(+rid);
          const isOpen=expandedRetailers.has(+rid);
          const pendingCount=ss.filter(s=>s.status==="pending_moderation").length;
          return (
          <div key={rid} style={{ marginBottom:12 }}>
            <div onClick={()=>toggleExpand(+rid)} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"white",border:"1px solid #e2e8f0",borderRadius:isOpen?"10px 10px 0 0":"10px",cursor:"pointer" }}>
              <RetailerLogo retailer={r} size={28}/>
              <div style={{ flex:1 }}>
                <strong>{r?.name}</strong>{r?.active===false&&<Badge color="#94a3b8" style={{marginLeft:6}}>Nieaktywna</Badge>}
                <div style={{ fontSize:11,color:"#64748b" }}>{FLAGS[r?.country]||"🌐"} · {ss.length} propozycji{pendingCount>0&&<span style={{color:"#d97706",fontWeight:700,marginLeft:6}}>· {pendingCount} wymaga moderacji</span>}</div>
              </div>
              <Badge color={ss.length>=8?"#dc2626":"#059669"}>{ss.length}/10 slotów</Badge>
              <Btn sm onClick={(e)=>{e.stopPropagation();setEmailPreview({retailer:r,sends:ss,supplierCo:(companies||[]).find(c=>c.id===ss[0]?.supplierId)||COMPANY_INIT})}} style={{ background:"rgba(37,99,235,0.08)",color:"#2563eb",border:"1px solid rgba(37,99,235,0.25)",gap:5 }}>
                <Mail size={11}/> E-mail
              </Btn>
              <span style={{color:"#94a3b8",fontSize:13}}>{isOpen?"▲":"▼"}</span>
            </div>
            {isOpen&&<div style={{ border:"1px solid #e2e8f0",borderTop:"none",borderRadius:"0 0 10px 10px",overflow:"hidden" }}>
              {ss.map(s=>{ const o=getOffer(s.offerId,offers); const ip=s.status==="pending_moderation"; const ia=s.status==="approved"; const isPrem=o?.tier==="premium"; return (
                <div key={s.id} style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9",background:isPrem?"#fffdf5":ip?"#fffbeb":ia?"#eff6ff":"white" }}>
                  <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:3 }}>
                      <input type="number" min={1} max={20} value={s.pos||1} onChange={e=>updateSendPos(s.id,e.target.value)} style={{ width:44,textAlign:"center",padding:"3px 6px",border:"2px solid #e2e8f0",borderRadius:6,fontSize:13,fontWeight:700,fontFamily:"inherit" }}/>
                      <span style={{ fontSize:10,color:"#94a3b8" }}>poz.</span>
                    </div>
                    {isPrem&&<Badge color="#d97706" bg="#fef3c7"><Star size={9} fill="#d97706" color="#d97706"/> Prem.</Badge>}
                    <div style={{ flex:1 }}><strong style={{ fontSize:12 }}>{CEMOJI[o?.category]} {o?.title||o?.product}</strong><div style={{ fontSize:11,color:"#64748b" }}>{o?.volume} {o?.volumeUnit}</div></div>
                    <Badge color={ip?"#d97706":ia?"#2563eb":"#059669"}>{ip?"Do moderacji":ia?"Zatwierdzona":"W kolejce"}</Badge>
                    <Btn sm outline onClick={()=>setPreviewOffer(o)}><Eye size={10}/></Btn>
                    {ip&&<><Btn sm onClick={()=>moderate(s.id,"approve")} style={{ background:"#059669",color:"white",border:"none",padding:"6px 14px" }}><CheckCircle size={13}/> Zatwierdź</Btn><Btn sm onClick={()=>moderate(s.id,"reject")} style={{ background:"#dc2626",color:"white",border:"none",padding:"6px 14px" }}><X size={13}/> Odrzuć</Btn></>}
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:7,fontSize:11,color:"#64748b" }}>
                    <Clock size={10}/> Data wysyłki:
                    <input type="date" value={s.sendDate||"2026-05-06"} onChange={e=>updateSendDate(s.id,e.target.value)} style={{ padding:"2px 7px",border:"1px solid #e2e8f0",borderRadius:5,fontSize:11,fontFamily:"inherit" }}/>
                    <span style={{ color:"#94a3b8" }}>domyślnie: 1. wtorek miesiąca</span>
                  </div>
                </div>
              );})}
            </div>}
          </div>
        );})}
      </>}

      {/* TRACKING TAB */}
      {tab==="track"&&<>
        <Alrt type={sentSends.filter(s=>s.status==="sent").length>0?"warning":"success"}>
          {sentSends.filter(s=>s.status==="sent").length>0?<><strong>{sentSends.filter(s=>s.status==="sent").length}</strong> propozycji czeka na potwierdzenie odczytu (14 dni).</>:"Wszystkie dostarczone propozycje mają potwierdzenie."}
        </Alrt>
        {sentSends.map(s=>{ const o=getOffer(s.offerId,offers); const r=getRetailerLive(s.retailerId); const isAuto=s.status==="read"; const isConf=["read","read_manual"].includes(s.status); const histLen=(s.confirmHistory||[]).length; return (
          <Card key={s.id} style={{ borderLeft:`3px solid ${s.status==="sent"?"#ea580c":isAuto?"#059669":"#047857"}`,marginBottom:10 }}>
            <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:isConf?0:10,flexWrap:"wrap" }}>
              <RetailerLogo retailer={r} size={28}/>
              <div style={{ flex:1 }}>
                <strong style={{ fontSize:13 }}>{CEMOJI[o?.category]} {o?.title||o?.product}</strong>
                <div style={{ fontSize:12,color:"#64748b" }}>→ {r?.name} · {r?.buyer} · {s.sentAt}</div>
                {/* TrackingBar only here in detail – not on list */}
                {s.status==="sent"&&<div style={{ marginTop:5 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8",marginBottom:2 }}><span>Tracking 14 dni</span><span style={{ color:s.daysLeft<=3?"#dc2626":"#f59e0b" }}>{s.daysLeft} dni pozostało</span></div>
                  <div style={{ background:"#e2e8f0",borderRadius:3,height:4,overflow:"hidden" }}><div style={{ height:"100%",background:s.daysLeft<=3?"#dc2626":"#f59e0b",width:`${((14-s.daysLeft)/14)*100}%` }}/></div>
                </div>}
              </div>
              <div style={{ display:"flex",gap:5,flexShrink:0 }}>
                {isConf?<Badge color={isAuto?"#059669":"#047857"}>{isAuto?"Auto (pixel)":"Manual"}</Badge>:<Badge color="#ea580c">Nieprzeczytana</Badge>}
                <Btn sm outline onClick={()=>setPreviewOffer(o)}><Eye size={10}/></Btn>
                <Btn sm outline onClick={()=>setHistoryId(s.id)} style={{ position:"relative" }}><Clock size={10}/>{histLen>0&&<span style={{ position:"absolute",top:-4,right:-4,background:"#2563eb",color:"white",borderRadius:"50%",fontSize:9,width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center" }}>{histLen}</span>}</Btn>
                {isConf&&<Btn sm danger onClick={()=>undoConfirm(s.id)} style={{ fontSize:11 }}><RotateCcw size={10}/> Cofnij</Btn>}
              </div>
            </div>
            {!isConf&&s.status==="sent"&&<ConfirmForm send={s} onConfirm={(id,rt,note)=>{ confirmManual(id,rt,note); fl("Potwierdzenie zapisane."); }}/>}
            {isConf&&<div style={{ padding:"8px 10px",background:"#f8fafc",borderRadius:7,fontSize:12,marginTop:4 }}>
              {isAuto?<span style={{ color:"#059669" }}>Automatyczne – pixel tracking</span>:<><strong>{s.readType==="manual_phone"?"Telefon":s.readType==="manual_email"?"E-mail":"Spotkanie"}</strong>{s.manualNote&&<span style={{ color:"#64748b" }}> · {s.manualNote}</span>}</>}
              {s.readAt&&<span style={{ marginLeft:10,color:"#047857" }}>✓ {s.readAt}</span>}
            </div>}
          </Card>
        );})}
      </>}
    </div>
  );
}

/* ── Admin: Sieci ─────────────────────────────────────────────────────── */
function PageAdminRetailers({ retailers, setRetailers }) {
  const CAT_OPTS = [["owoce","🍎 Owoce"],["warzywa","🥕 Warzywa"],["kwiaty","🌸 Kwiaty"]];
  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  const [search, setSearch]               = useState("");
  const [filterCat, setFilterCat]         = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterActive, setFilterActive]   = useState("all");
  const [showForm, setShowForm]           = useState(false);
  const [formError, setFormError]         = useState({});
  const EMPTY_RETAILER = {name:"",country:"PL",active:true,fm26ChainId:null,fm26Active:false,nextSend:"2026-05-06",color:"#0d9488",bg:"#f0fdfa",initials:"",description:"",buyers:[{id:"new_b1",name:"",email:"",phone:"",position:"",cats:[],active:true,fm26Active:false,isNew:true}]};
  const [newR, setNewR]     = useState({...EMPTY_RETAILER});
  const [expandedId, setExpandedId] = useState(null);
  const [savedIds, setSavedIds]     = useState({});
  const [saveError, setSaveError]   = useState({});
  const [savingId, setSavingId]     = useState(null);
  const [saveMeta, setSaveMeta]     = useState({});

  function updateRetailer(id, changes) { setRetailers(prev=>prev.map(r=>r.id===id?{...r,...changes}:r)); }
  function updateBuyer(retailerId, buyerId, changes) {
    setRetailers(prev=>prev.map(r=>{
      if(r.id!==retailerId) return r;
      return{...r,buyers:(r.buyers||[]).map(b=>b.id===buyerId?{...b,...changes}:b)};
    }));
  }
  function addBuyer(retailerId) {
    const newId=retailerId+"_b"+Date.now();
    setRetailers(prev=>prev.map(r=>r.id!==retailerId?r:{...r,buyers:[...(r.buyers||[]),{id:newId,name:"",email:"",phone:"",position:"",cats:[],active:true,fm26Active:r.fm26Active||false,isNew:true}]}));
  }
  function removeBuyer(retailerId, buyerId) {
    setRetailers(prev=>prev.map(r=>{
      if(r.id!==retailerId) return r;
      return {
        ...r,
        buyers:(r.buyers||[]).flatMap(b => {
          if(b.id !== buyerId) return [b];
          if(isUuidLike(b.id)) return [{ ...b, active:false, _deactivated:true }];
          return [];
        })
      };
    }));
  }
  function toggleBuyerCat(retailerId, buyerId, cat) {
    setRetailers(prev=>prev.map(r=>{
      if(r.id!==retailerId) return r;
      return{...r,buyers:(r.buyers||[]).map(b=>{
        if(b.id!==buyerId) return b;
        const cats=(b.cats||[]).includes(cat)?(b.cats||[]).filter(c=>c!==cat):[...(b.cats||[]),cat];
        return{...b,cats};
      })};
    }));
  }
  function getDuplicateBuyerEmail(retailerId, buyerId, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    for (const retailer of retailers || []) {
      for (const buyer of retailer.buyers || []) {
        if (retailer.id === retailerId && buyer.id === buyerId) continue;
        if (buyer.active === false) continue;
        if (normalizeEmail(buyer.email) === normalized) {
          return { retailerName: retailer.name, buyerName: buyer.name || buyer.email || "kupiec" };
        }
      }
    }
    return null;
  }
  async function saveRetailer(id) {
    const retailer = retailers.find(r => r.id === id);
    if (!retailer) return;
    const errs = {};
    if(!retailer.name?.trim()) errs[id] = "Sieć musi mieć nazwę.";
    const buyers = (retailer.buyers||[]).map((b) => ({
      ...b,
      name: String(b.name || "").trim(),
      email: normalizeEmail(b.email),
      phone: String(b.phone || "").trim(),
      position: String(b.position || "").trim(),
      cats: [...new Set((b.cats || []).filter(Boolean))],
    }));
    const activeBuyers = buyers.filter((b) => b.active !== false);
    if (retailer.active !== false && activeBuyers.length === 0) errs[id] = "Aktywna sieć musi mieć przynajmniej jednego aktywnego kupca.";
    if (retailer.fm26Active && !activeBuyers.some((b) => b.fm26Active)) errs[id] = "Sieć FM 2026 musi mieć przynajmniej jednego aktywnego kupca oznaczonego dla FM 2026.";
    const seenEmails = new Set();
    for (const b of buyers) {
      if (b.active === false && !b.isNew) continue;
      if (!b.name?.trim()) { errs[id] = "Każdy aktywny kupiec musi mieć imię i nazwisko."; break; }
      if (!b.email?.trim()) { errs[id] = "Każdy aktywny kupiec musi mieć email."; break; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) { errs[id] = `Adres e-mail kupca "${b.name || b.email}" ma niepoprawny format.`; break; }
      const emailKey = String(b.email || "").trim().toLowerCase();
      if (emailKey && seenEmails.has(emailKey)) { errs[id] = "Email kupca w obrębie jednej sieci musi być unikalny."; break; }
      const duplicate = getDuplicateBuyerEmail(id, b.id, emailKey);
      if (duplicate) { errs[id] = `Email ${emailKey} jest już przypisany do kupca ${duplicate.buyerName} w sieci ${duplicate.retailerName}.`; break; }
      if (emailKey) seenEmails.add(emailKey);
      if ((b.cats||[]).length === 0) { errs[id] = "Każdy aktywny kupiec musi mieć min. 1 kategorię."; break; }
    }
    if (retailer.fm26Active && !retailer.fm26ChainId) errs[id] = "Sieć FM 2026 musi mieć ustawione ID łańcucha.";
    if (Object.keys(errs).length) { setSaveError(prev => ({ ...prev, ...errs })); return; }

    setSavingId(id);
    setSaveError(prev => ({ ...prev, [id]: null }));
    try {
      await bulkUpsertRetailers([retailer]);
      const links = [];
      const nextBuyers = [];
      for (const b of buyers) {
        if (b.isNew || !isUuidLike(b.id)) {
          if (b.active === false) continue;
          const created = await dbCreateBuyerAccount({
            email: b.email,
            name: b.name,
            retailer_id: id,
            phone: b.phone || null,
            position: b.position || null,
            buyer_categories: b.cats || [],
            active: b.active !== false,
            fm26_active: !!b.fm26Active,
          });
          if (created.magic_link) {
            links.push({ email: b.email, magic_link: created.magic_link });
          }
          nextBuyers.push({
            id: created.user_id,
            name: created.profile?.name || b.name,
            email: created.profile?.email || b.email,
            phone: created.profile?.phone || b.phone || "",
            position: created.profile?.position || b.position || "",
            cats: created.profile?.buyer_categories || b.cats || [],
            active: created.profile?.active !== false,
            fm26Active: !!created.profile?.fm26_active,
            isManaged: true,
          });
        } else if (isUuidLike(b.id)) {
          const updated = await dbAdminUpdateBuyerAccount({
            user_id: b.id,
            email: b.email,
            name: b.name,
            phone: b.phone || null,
            position: b.position || null,
            retailer_id: id,
            active: b.active !== false,
            fm26_active: !!b.fm26Active,
            buyer_categories: b.cats || [],
          });
          nextBuyers.push({
            id: updated.id,
            name: updated.name || b.name,
            email: updated.email || b.email,
            phone: updated.phone || b.phone || "",
            position: updated.position || b.position || "",
            cats: updated.buyer_categories || b.cats || [],
            active: updated.active !== false,
            fm26Active: !!updated.fm26_active,
            isManaged: true,
          });
        } else {
          nextBuyers.push({ ...b });
        }
      }

      setRetailers(prev => prev.map(r => r.id !== id ? r : ({ ...r, buyers: nextBuyers })));
      setSaveMeta(prev => ({ ...prev, [id]: { links } }));
      setSavedIds(prev=>({...prev,[id]:true}));
      setTimeout(()=>setSavedIds(prev=>{const n={...prev};delete n[id];return n;}),2500);
    } catch (e) {
      setSaveError(prev => ({ ...prev, [id]: e?.message || "Nie udało się zapisać zmian." }));
    } finally {
      setSavingId(null);
    }
  }
  function toggleNewBuyerCat(cat) {
    setNewR(prev=>{const buyers=[...prev.buyers];const b={...buyers[0]};b.cats=(b.cats||[]).includes(cat)?(b.cats||[]).filter(c=>c!==cat):[...(b.cats||[]),cat];buyers[0]=b;return{...prev,buyers};});
  }
  function addRetailer() {
    const errs={};
    if(!newR.name.trim()) errs.name="Wymagana";
    if(!newR.country) errs.country="Wymagany";
    if(!newR.buyers[0].name.trim()) errs.buyerName="Wymagane";
    if(!newR.buyers[0].email.trim()) errs.buyerEmail="Wymagany";
    if(newR.buyers[0].email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newR.buyers[0].email.trim())) errs.buyerEmail="Niepoprawny email";
    if((newR.buyers[0].cats||[]).length===0) errs.buyerCats="Wybierz min. 1";
    const duplicate = getDuplicateBuyerEmail(null, null, newR.buyers[0].email);
    if (duplicate) errs.buyerEmail=`Email jest już przypisany do ${duplicate.buyerName} w sieci ${duplicate.retailerName}`;
    if(newR.fm26Active && !newR.fm26ChainId?.trim()) errs.fm26ChainId="Wymagane gdy sieć uczestniczy w FM 2026 (np. ch28)";
    if(newR.fm26Active && newR.fm26ChainId?.trim() && retailers.some(r=>r.fm26ChainId===newR.fm26ChainId.trim())) errs.fm26ChainId="Ten ID jest już zajęty przez inną sieć";
    if(Object.keys(errs).length>0){setFormError(errs);return;}
    const initials=newR.name.split(" ").map(w=>w[0]).join("").slice(0,3).toUpperCase();
    const newId=Math.max(...retailers.map(r=>r.id),120)+1;
    const entry={...newR,id:newId,initials:initials||newR.name.slice(0,3).toUpperCase(),buyers:newR.buyers.map((b,i)=>({...b,id:`${newId}_b${i+1}`,isNew:true}))};
    setRetailers(prev=>[...prev,entry]);
    setNewR({...EMPTY_RETAILER,buyers:[{id:"new_b1",name:"",email:"",phone:"",position:"",cats:[],active:true,fm26Active:false,isNew:true}]});
    setFormError({});setShowForm(false);setExpandedId(newId);
  }
  const filtered=retailers.filter(r=>{
    if(search&&!r.name.toLowerCase().includes(search.toLowerCase())&&!(CNAMES[r.country]||"").toLowerCase().includes(search.toLowerCase())) return false;
    if(filterCountry&&r.country!==filterCountry) return false;
    if(filterCat&&!(r.buyers||[]).some(b=>(b.cats||[]).includes(filterCat))) return false;
    if(filterActive==="active"&&r.active===false) return false;
    if(filterActive==="inactive"&&r.active!==false) return false;
    return true;
  });
  const fldStyle=(errKey)=>({width:"100%",padding:"7px 10px",border:`1px solid ${formError[errKey]?"#dc2626":"#e2e8f0"}`,borderRadius:7,fontSize:12,fontFamily:"inherit",background:formError[errKey]?"#fef2f2":"white",boxSizing:"border-box"});

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:2}}>Sieci handlowe i kupcy</div>
          <div style={{fontSize:12,color:"#64748b"}}>{retailers.filter(r=>r.active!==false).length} aktywnych · {retailers.filter(r=>r.active===false).length} nieaktywnych · {retailers.reduce((a,r)=>(a+(r.buyers||[]).length),0)} kupców łącznie</div>
        </div>
        <Btn dark onClick={()=>setShowForm(!showForm)}><Plus size={13}/> {showForm?"Anuluj":"Dodaj sieć"}</Btn>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Szukaj sieci lub kraju..." style={{flex:1,minWidth:180,padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"inherit"}}/>
        <select value={filterCountry} onChange={e=>setFilterCountry(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
          <option value="">Wszystkie kraje</option>
          {[...new Set(retailers.map(r=>r.country))].sort().map(c=><option key={c} value={c}>{FLAGS[c]||"🌐"} {CNAMES[c]||c}</option>)}
        </select>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
          <option value="">Wszystkie kategorie</option>
          {CAT_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filterActive} onChange={e=>setFilterActive(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit"}}>
          <option value="all">Wszystkie</option>
          <option value="active">Aktywne</option>
          <option value="inactive">Nieaktywne</option>
        </select>
      </div>
      {showForm&&(
        <div style={{background:"white",border:"2px solid #0d9488",borderRadius:12,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:14,color:"#0d9488",marginBottom:16}}>Nowa sieć handlowa</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            <div>
              <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>NAZWA *</label>
              <input value={newR.name} onChange={e=>setNewR(p=>({...p,name:e.target.value}))} placeholder="np. Kaufland CZ" style={fldStyle("name")}/>
              {formError.name&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>{formError.name}</div>}
            </div>
            <div>
              <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>KRAJ *</label>
              <select value={newR.country} onChange={e=>setNewR(p=>({...p,country:e.target.value}))} style={fldStyle("country")}>
                <option value="">— wybierz —</option>
                {CNAMES_SORTED.map(([k,v])=><option key={k} value={k}>{FLAGS[k]||"🌐"} {v}</option>)}
              </select>
              {formError.country&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>{formError.country}</div>}
            </div>
            <div>
              <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>PIERWSZA WYSYŁKA</label>
              <input type="date" value={newR.nextSend} onChange={e=>setNewR(p=>({...p,nextSend:e.target.value}))} style={fldStyle("nextSend")}/>
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>OPIS / NOTATKA</label>
            <textarea value={newR.description||""} onChange={e=>setNewR(p=>({...p,description:e.target.value}))} rows={3} style={{width:"100%",padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical"}}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,fontWeight:500}}>
              <input type="checkbox" checked={newR.fm26Active||false}
                onChange={e=>setNewR(p=>({...p,fm26Active:e.target.checked,fm26ChainId:e.target.checked?p.fm26ChainId:null}))}
                style={{width:15,height:15,accentColor:"#0d9488"}}/>
              Sieć uczestniczy w Fresh Market 2026
            </label>
            {newR.fm26Active&&(
              <div style={{marginTop:8,padding:"10px 12px",background:"#eff6ff",borderRadius:8,border:`1px solid ${formError.fm26ChainId?"#dc2626":"#bfdbfe"}`}}>
                <label style={{fontSize:12,fontWeight:600,color:"#1e40af",display:"block",marginBottom:4}}>
                  ID sieci FM 2026 (fm26ChainId) <span style={{color:"#dc2626"}}>*</span>
                </label>
                <input
                  value={newR.fm26ChainId||""}
                  onChange={e=>setNewR(p=>({...p,fm26ChainId:e.target.value.trim()||null}))}
                  placeholder="np. ch28, ch29 — musi być unikalne"
                  style={{width:"100%",padding:"7px 10px",border:`1px solid ${formError.fm26ChainId?"#dc2626":"#bfdbfe"}`,borderRadius:7,fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}}/>
                {formError.fm26ChainId
                  ? <div style={{fontSize:10,color:"#dc2626",marginTop:2}}>{formError.fm26ChainId}</div>
                  : <div style={{fontSize:10,color:"#3b82f6",marginTop:2}}>Bez tego ID sieć nie pojawi się w panelu dostawcy FM. Np. ch28, ch29...</div>
                }
              </div>
            )}
          </div>
          <div style={{borderTop:"1px solid #f1f5f9",paddingTop:14,marginBottom:14}}>
            <div style={{fontWeight:600,fontSize:12,marginBottom:10,color:"#334155"}}>Kupiec (główna osoba kontaktowa)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div>
                <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>IMIĘ I NAZWISKO *</label>
                <input value={newR.buyers[0].name} onChange={e=>setNewR(p=>{const b=[...p.buyers];b[0]={...b[0],name:e.target.value};return{...p,buyers:b};})} placeholder="np. Anna Kowalska" style={fldStyle("buyerName")}/>
                {formError.buyerName&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>{formError.buyerName}</div>}
              </div>
              <div>
                <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>EMAIL *</label>
                <input type="email" value={newR.buyers[0].email} onChange={e=>setNewR(p=>{const b=[...p.buyers];b[0]={...b[0],email:e.target.value};return{...p,buyers:b};})} placeholder="kupiec@siec.pl" style={fldStyle("buyerEmail")}/>
                {formError.buyerEmail&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>{formError.buyerEmail}</div>}
              </div>
              <div>
                <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>TELEFON</label>
                <input value={newR.buyers[0].phone} onChange={e=>setNewR(p=>{const b=[...p.buyers];b[0]={...b[0],phone:e.target.value};return{...p,buyers:b};})} placeholder="+48 22 123 4567" style={fldStyle("phone")}/>
              </div>
              <div>
                <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>STANOWISKO</label>
                <input value={newR.buyers[0].position||""} onChange={e=>setNewR(p=>{const b=[...p.buyers];b[0]={...b[0],position:e.target.value};return{...p,buyers:b};})} placeholder="np. Category Manager" style={fldStyle("position")}/>
              </div>
            </div>
            <div>
              <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:6}}>ODPOWIEDZIALNOŚĆ *</label>
              <div style={{display:"flex",gap:8}}>
                {CAT_OPTS.map(([val,lbl])=>(
                  <label key={val} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",border:`2px solid ${newR.buyers[0].cats.includes(val)?"#0d9488":"#e2e8f0"}`,borderRadius:8,cursor:"pointer",fontSize:12,background:newR.buyers[0].cats.includes(val)?"rgba(13,148,136,0.06)":"white",color:newR.buyers[0].cats.includes(val)?"#0d9488":"#475569",fontWeight:newR.buyers[0].cats.includes(val)?600:500,userSelect:"none"}}>
                    <input type="checkbox" checked={newR.buyers[0].cats.includes(val)} onChange={()=>toggleNewBuyerCat(val)} style={{display:"none"}}/>
                    {lbl}
                  </label>
                ))}
              </div>
              {formError.buyerCats&&<div style={{fontSize:10,color:"#dc2626",marginTop:4}}>{formError.buyerCats}</div>}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn primary onClick={addRetailer}><Plus size={13}/> Dodaj sieć</Btn>
            <Btn outline onClick={()=>{setShowForm(false);setFormError({});setNewR({...EMPTY_RETAILER,buyers:[{id:"new_b1",name:"",email:"",phone:"",position:"",cats:[],active:true,fm26Active:false,isNew:true}]});}}>Anuluj</Btn>
          </div>
        </div>
      )}
      {filtered.length===0&&<div style={{padding:32,textAlign:"center",color:"#94a3b8",background:"white",borderRadius:12,border:"1px solid #e2e8f0"}}>Brak sieci spełniających kryteria.</div>}
      {filtered.map(r=>{
        const isExpanded=expandedId===r.id;
        const isSaved=savedIds[r.id];
        const allCats=[...new Set((r.buyers||[]).flatMap(b=>b.cats||[]))];
        return (
          <div key={r.id} style={{marginBottom:10,background:"white",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden",opacity:r.active===false?0.6:1,borderLeft:`3px solid ${r.active===false?"#94a3b8":"transparent"}`}}>
            <div style={{display:"flex",gap:12,alignItems:"center",padding:"12px 16px",cursor:"pointer",background:isExpanded?"#f8fafc":"white"}} onClick={()=>setExpandedId(isExpanded?null:r.id)}>
              <RetailerLogo retailer={r} size={36}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:14}}>{r.name}</span>
                  <span style={{fontSize:12,color:"#64748b"}}>{FLAGS[r.country]||"🌐"} {CNAMES[r.country]||r.country}</span>
                  {allCats.map(c=><Badge key={c} color="#0d9488">{CEMOJI[c]} {c}</Badge>)}
                </div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{(r.buyers||[]).filter(b=>b.active!==false).length} kupców aktywnych · Wysyłka: {r.nextSend||"—"}</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                {isSaved&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>✅ Zapisano</span>}
                <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:600,border:`1px solid ${r.active!==false?"#bbf7d0":"#fca5a5"}`,background:r.active!==false?"#f0fdf4":"#fef2f2",color:r.active!==false?"#059669":"#dc2626",userSelect:"none"}} onClick={e=>e.stopPropagation()}>
                  <input type="checkbox" checked={r.active!==false} onChange={e=>updateRetailer(r.id,{active:e.target.checked})} style={{display:"none"}}/>
                  {r.active!==false?"✅ Aktywna":"⛔ Nieaktywna"}
                </label>
                <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:600,userSelect:"none",border:`1px solid ${r.fm26Active?"#2563eb":"#e2e8f0"}`,background:r.fm26Active?"#eff6ff":"#f8fafc",color:r.fm26Active?"#2563eb":"#94a3b8"}} onClick={e=>e.stopPropagation()}>
                  <input type="checkbox" checked={r.fm26Active||false} onChange={e=>updateRetailer(r.id,{fm26Active:e.target.checked})} style={{display:"none"}}/>
                  {r.fm26Active?"📅 FM 2026":"📅 Poza FM"}
                </label>
                <span style={{fontSize:16,color:"#94a3b8"}}>{isExpanded?"▲":"▼"}</span>
              </div>
            </div>
            {isExpanded&&(
              <div style={{padding:"0 16px 16px",borderTop:"1px solid #f1f5f9"}}>
                {/* Logo retailera */}
                <div style={{margin:"14px 0",padding:12,background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
                  <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:8,fontWeight:600}}>LOGO SIECI</label>
                  <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                    <div style={{width:64,height:64,borderRadius:10,background:r.logo_url?"white":(r.bg||"#f1f5f9"),border:`2px solid ${r.color}44`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {r.logo_url
                        ? <img src={r.logo_url} alt={r.name} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                        : <span style={{fontWeight:800,fontSize:20,color:r.color,letterSpacing:-1}}>{r.initials}</span>}
                    </div>
                    <div style={{flex:1}}>
                      <SimplePhotoUploader
                        /* [B2B Round 5.7] Retailer logos own bucket + clean ID.
                           Previously uploaded to `company-logos/retailer-{id}/...`
                           which mixed retailer files with company logos and
                           bypassed RLS only via is_admin() because the prefix
                           string never matched app_company_id(). Now: dedicated
                           `retailer-logos` bucket (migration 020), pathPrefix is
                           the bare retailer.id so the convention matches:
                              retailer-logos/<retailer_id>/<filename> */
                        bucket="retailer-logos"
                        pathPrefix={r.id != null ? String(r.id) : ""}
                        value={r.logo_url || null}
                        onChange={(newUrl) => updateRetailer(r.id, { logo_url: newUrl })}
                        multi={false}
                        label={r.logo_url ? "Kliknij aby zmienić logo sieci" : "Kliknij aby wgrać logo sieci"}
                      />
                    </div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,margin:"14px 0"}}>
                  <div><label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>NAZWA</label><input value={r.name||""} onChange={e=>updateRetailer(r.id,{name:e.target.value})} style={{width:"100%",padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}}/></div>
                  <div><label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>KRAJ</label><select value={r.country||"PL"} onChange={e=>updateRetailer(r.id,{country:e.target.value})} style={{width:"100%",padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}}>{CNAMES_SORTED.map(([k,v])=><option key={k} value={k}>{FLAGS[k]||"🌐"} {v}</option>)}</select></div>
                  <div><label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>NASTĘPNA WYSYŁKA</label><input type="date" value={r.nextSend||""} onChange={e=>updateRetailer(r.id,{nextSend:e.target.value})} style={{width:"100%",padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}}/></div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:3}}>OPIS / NOTATKA ADMINA</label>
                  <textarea value={r.description||""} onChange={e=>updateRetailer(r.id,{description:e.target.value})} rows={3} style={{width:"100%",padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical"}}/>
                </div>
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontWeight:600,fontSize:13}}>Kupcy ({(r.buyers||[]).length})</span>
                    <Btn sm outline onClick={()=>addBuyer(r.id)}><Plus size={11}/> Dodaj kupca</Btn>
                  </div>
                  {(r.buyers||[]).map((b,bi)=>(
                    <div key={b.id} style={{padding:"12px 14px",background:"#f8fafc",borderRadius:10,marginBottom:8,border:"1px solid #e2e8f0",opacity:b.active===false?0.55:1}}>
                      <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
                        <span style={{fontSize:11,color:"#94a3b8",fontWeight:700}}>Kupiec #{bi+1}</span>
                        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
                          <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,fontWeight:600,color:b.active!==false?"#059669":"#dc2626",userSelect:"none"}}>
                            <input type="checkbox" checked={b.active!==false} onChange={e=>updateBuyer(r.id,b.id,{active:e.target.checked})} style={{marginTop:0,width:13,height:13,cursor:"pointer",accentColor:"#0d9488"}}/>
                            {b.active!==false?"Aktywny":"Nieaktywny"}
                          </label>
                          <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,color:"#2563eb",userSelect:"none"}}>
                            <input type="checkbox" checked={b.fm26Active||false} onChange={e=>updateBuyer(r.id,b.id,{fm26Active:e.target.checked})} style={{width:13,height:13,cursor:"pointer",accentColor:"#2563eb"}}/>
                            FM 2026
                          </label>
                          {(r.buyers||[]).length>1&&<button onClick={()=>removeBuyer(r.id,b.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:2,fontSize:11}}><X size={13}/></button>}
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
                        {[["IMIĘ I NAZWISKO","name",b.name,"text","np. Anna Nowak"],["EMAIL","email",b.email,"email","kupiec@siec.pl"],["TELEFON","phone",b.phone,"tel","+48 22 ..."],["STANOWISKO","position",b.position,"text","np. Category Manager"]].map(([lbl,key,val,type,ph])=>(
                          <div key={key}><label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:2}}>{lbl}</label><input type={type} value={val||""} placeholder={ph} onChange={e=>updateBuyer(r.id,b.id,{[key]:e.target.value})} style={{width:"100%",padding:"6px 9px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}}/></div>
                        ))}
                      </div>
                      <div>
                        <label style={{fontSize:10,color:"#94a3b8",display:"block",marginBottom:6}}>ODPOWIADA ZA</label>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {CAT_OPTS.map(([val,lbl])=>(
                            <label key={val} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",border:`1.5px solid ${(b.cats||[]).includes(val)?"#0d9488":"#e2e8f0"}`,borderRadius:20,cursor:"pointer",fontSize:12,background:(b.cats||[]).includes(val)?"rgba(13,148,136,0.07)":"white",color:(b.cats||[]).includes(val)?"#0d9488":"#475569",fontWeight:(b.cats||[]).includes(val)?600:400,userSelect:"none"}}>
                              <input type="checkbox" checked={(b.cats||[]).includes(val)} onChange={()=>toggleBuyerCat(r.id,b.id,val)} style={{display:"none"}}/>
                              {lbl}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {saveMeta[r.id]?.links?.length > 0 && (
                  <div style={{marginTop:12,padding:"10px 12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#1d4ed8",marginBottom:6}}>Nowe konta kupców utworzone</div>
                    {saveMeta[r.id].links.map((lnk, idx) => (
                      <div key={idx} style={{fontSize:11,color:"#334155",marginBottom:4,wordBreak:"break-all"}}>
                        <strong>{lnk.email}</strong>: {lnk.magic_link}
                      </div>
                    ))}
                  </div>
                )}
                {saveError[r.id] && (
                  <div style={{marginTop:12,padding:"10px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:12,color:"#b91c1c"}}>
                    {saveError[r.id]}
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginTop:14,paddingTop:12,borderTop:"1px solid #f1f5f9"}}>
                  <Btn primary onClick={()=>saveRetailer(r.id)}>{savingId===r.id ? "Zapisywanie..." : "💾 Zapisz zmiany"}</Btn>
                  <Btn outline onClick={()=>setExpandedId(null)}>Zwiń</Btn>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}



/* ── Admin Firmy: pakiety, limity, rozliczenia per firma ─────────────────── */
// [B2B Round supplier-onboarding-access-and-communication]
const ACCOUNT_STATUS_LABELS = {
  pending_review: ["Czeka na zatwierdzenie", "#92400e", "#fef3c7"],
  active:         ["✓ Aktywne",                 "#059669", "#d1fae5"],
  rejected:       ["Odrzucone",                 "#dc2626", "#fee2e2"],
  suspended:      ["Wstrzymane",                "#dc2626", "#fee2e2"],
};

function PageAdminFirmy({ limits, updateLimit, sends, offers, orders, fl, retailers, companies, setCompanies, dbCapacity, refreshCapacity }) {
  function getRetailerLive(id) {
    return (retailers||[]).find(r=>r.id===id) || null;
  }
  const [expandedId, setExpandedId] = useState(null);
  // [B2B Round supplier-onboarding-access-and-communication]
  // Filtr listy: "all" | "pending" — admin chce szybko zobaczyć tylko nowe rejestracje.
  const [filter, setFilter] = useState("all");
  const [statusNoteDraft, setStatusNoteDraft] = useState({}); // { [companyId]: "powód" }
  const [savingStatusId, setSavingStatusId] = useState(null);
  // [B2B Round adaptive-company-profile-ai] Per-company state dla edytora
  // opisów AI: trwająca regeneracja, edycja inline, podgląd profilu kupca.
  const [aiLoadingId, setAiLoadingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ description_short: "", description: "" });
  const [previewCompany, setPreviewCompany] = useState(null);

  function patchCompany(id, patch) {
    setCompanies?.(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    // Po zmianie account_status / preconnect_enabled / fm_b2b_enabled odśwież
    // view company_capacity, żeby filtry i countery były zsynchronizowane.
    if (refreshCapacity && (
      "account_status" in patch ||
      "preconnect_enabled" in patch ||
      "fm_b2b_enabled" in patch ||
      "pkg_plan" in patch
    )) {
      refreshCapacity();
    }
  }

  async function regenerateForCompany(firmCo) {
    if (!firmCo?.name) {
      fl("Firma nie ma jeszcze nazwy — nie da się wygenerować opisu.", "warning");
      return;
    }
    setAiLoadingId(firmCo.id);
    try {
      const result = await dbGenerateCompanyDescriptionAI({
        company_id: firmCo.id,
        company: firmCo,
      });
      patchCompany(firmCo.id, {
        description: result?.description || "",
        description_short: result?.description_short || "",
        ai_review_status: "pending",
      });
      fl(`AI wygenerował opisy dla ${firmCo.name}. ${result?.richness === "rich" ? "(profil rozszerzony)" : result?.richness === "minimal" ? "(profil krótki)" : ""}`.trim());
    } catch (e) {
      fl(e?.message || "Nie udało się wygenerować opisu firmy.", "warning");
    } finally {
      setAiLoadingId(null);
    }
  }

  function approveDescriptions(firmCo) {
    patchCompany(firmCo.id, { ai_review_status: "approved" });
    fl(`Profil firmy ${firmCo.name} zatwierdzony.`);
  }

  function startEdit(firmCo) {
    setEditingId(firmCo.id);
    setEditDraft({
      description_short: firmCo.description_short || "",
      description: firmCo.description || "",
    });
  }
  function saveEdit(firmCo) {
    patchCompany(firmCo.id, {
      description_short: editDraft.description_short || null,
      description: editDraft.description || null,
      ai_review_status: "edited",
    });
    setEditingId(null);
    fl(`Opisy zapisane dla ${firmCo.name}.`);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft({ description_short: "", description: "" });
  }

  // [B2B Round supplier-onboarding-access-and-communication]
  // Zmiana account_status / preconnect_enabled / fm_b2b_enabled ZAWSZE
  // przelatuje przez setCompanies → bulkUpsertCompanies (DB sync) plus
  // wysyła powiadomienie mailem zależnie od typu zmiany.
  async function changeAccountStatus(firmCo, newStatus) {
    setSavingStatusId(firmCo.id);
    const note = (statusNoteDraft[firmCo.id] || "").trim() || null;
    const patch = {
      account_status: newStatus,
      status_note: note,
    };
    // Aktywacja → włącz PreConnect domyślnie (FM B2B zostaje opt-in adminskim).
    if (newStatus === "active") {
      patch.preconnect_enabled = true;
      patch.approved_at = new Date().toISOString();
    }
    patchCompany(firmCo.id, patch);
    setStatusNoteDraft(prev => ({ ...prev, [firmCo.id]: "" }));
    // Email transactional fire-and-forget
    const tplName = newStatus === "active" ? "account_activated"
                  : newStatus === "rejected" ? "account_rejected"
                  : newStatus === "suspended" ? "account_suspended"
                  : null;
    if (tplName) {
      const result = await dbNotifySupplier({
        template: tplName,
        company_id: firmCo.id,
        payload: {
          companyName: firmCo.name,
          preconnectEnabled: newStatus === "active" ? true : !!firmCo.preconnect_enabled,
          fmB2bEnabled: !!firmCo.fm_b2b_enabled,
          statusNote: note,
        },
      });
      if (result.ok) {
        fl(`Status firmy ${firmCo.name} → ${newStatus}. Mail wysłany.`);
      } else {
        fl(`Status firmy ${firmCo.name} → ${newStatus}. (Mail nie został wysłany — sprawdź konfigurację.)`, "warning");
      }
    } else {
      fl(`Status firmy ${firmCo.name} → ${newStatus}.`);
    }
    setSavingStatusId(null);
  }

  function toggleAccessFlag(firmCo, key, value) {
    patchCompany(firmCo.id, { [key]: value });
    fl(`${key === "preconnect_enabled" ? "PreConnect" : "Spotkania B2B"} ${value ? "aktywny" : "wyłączony"} dla ${firmCo.name}.`);
  }

  const reviewLabel = {
    pending: ["Czeka na review", "#92400e", "#fef3c7"],
    approved: ["✓ Zatwierdzony", "#059669", "#d1fae5"],
    edited: ["Edytowany ręcznie", "#0d9488", "#ccfbf1"],
    rejected: ["Odrzucony", "#dc2626", "#fee2e2"],
  };

  // [B2B Round prod-rollout / faza 2] Iterujemy po dbCapacity (view
  // company_capacity z bazy: companies + sum z packages), nie po LIMITS_INIT.
  // To pokazuje pełną listę firm + realne qty_used/qty_total z packages.
  // Fallback do `limits` (mock) tylko gdy dbCapacity jeszcze nie załadowane,
  // żeby uniknąć migotu pustego stanu przy pierwszym renderze.
  const capacitySource = (dbCapacity && dbCapacity.length > 0) ? dbCapacity : [];
  const allLims = capacitySource.map(c => ({
    id: c.id,
    name: c.name,
    country: c.country || "—",
    pkg: c.pkg_plan || "—",
    max: Number(c.qty_total || 0),
    used: Number(c.qty_used || 0),
    pkgExpiry: c.pkg_expiry ? String(c.pkg_expiry).slice(0, 10) : "—",
  }));
  const pendingCount = capacitySource.filter(c => c.account_status === "pending_review").length;
  const visibleLims = filter === "pending"
    ? allLims.filter(lim => {
        const co = capacitySource.find(c => c.id === lim.id);
        return co?.account_status === "pending_review";
      })
    : allLims;

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:12,flexWrap:"wrap" }}>
        <div style={{ fontWeight:700,fontSize:15 }}>Firmy, statusy i limity pakietów</div>
        <div style={{ display:"flex",gap:6 }}>
          <button onClick={()=>setFilter("all")} style={{ padding:"6px 12px",borderRadius:7,border:filter==="all"?"2px solid #0d9488":"1px solid #e2e8f0",background:filter==="all"?"rgba(13,148,136,0.05)":"white",fontSize:12,fontWeight:filter==="all"?600:500,cursor:"pointer",fontFamily:"inherit" }}>Wszystkie ({allLims.length})</button>
          <button onClick={()=>setFilter("pending")} style={{ padding:"6px 12px",borderRadius:7,border:filter==="pending"?"2px solid #d97706":"1px solid #e2e8f0",background:filter==="pending"?"rgba(217,119,6,0.05)":"white",fontSize:12,fontWeight:filter==="pending"?600:500,cursor:"pointer",fontFamily:"inherit" }}>
            Do zatwierdzenia {pendingCount > 0 && <span style={{ background:"#d97706",color:"white",borderRadius:10,fontSize:10,padding:"1px 6px",marginLeft:4 }}>{pendingCount}</span>}
          </button>
        </div>
      </div>
      {visibleLims.length === 0 && (
        <Alrt type="info">{filter === "pending" ? "Brak firm oczekujących na zatwierdzenie." : "Brak firm w systemie."}</Alrt>
      )}
      {visibleLims.map(lim=>{
        const isExpanded = expandedId===lim.id;
        // [B2B Round 5.5] Resolve firm by lim.id (UUID), then match sends across
        // all legacy_supplier_id formats. Falls back to id-only match if company
        // row isn't loaded yet.
        const firmCo = (companies||[]).find(c => c.id === lim.id) || { id: lim.id };
        const firmSends = sends.filter(s => legacyKeyMatchesCompany(s.supplierId, firmCo));
        const used = firmSends.filter(s=>!["rejected","refunded","queued"].includes(s.status)).length;
        const pct = lim.max>0 ? Math.round(used/lim.max*100) : 0;
        return (
          <div key={lim.id} style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,marginBottom:10,overflow:"hidden" }}>
            <div style={{ display:"flex",gap:12,alignItems:"center",padding:"12px 16px",cursor:"pointer" }} onClick={()=>setExpandedId(isExpanded?null:lim.id)}>
              <div style={{ width:36,height:36,borderRadius:8,background:"#1e3a5f",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:12,color:"white",flexShrink:0 }}>
                {lim.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:6 }}>
                  {lim.name}
                  {/* [B2B Round supplier-onboarding-access-and-communication] Status badge */}
                  {(() => {
                    const status = firmCo?.account_status || "active";
                    const [lbl, color, bg] = ACCOUNT_STATUS_LABELS[status] || ACCOUNT_STATUS_LABELS.active;
                    return <span style={{ fontSize:10,color,background:bg,padding:"2px 8px",borderRadius:4,fontWeight:700 }}>{lbl}</span>;
                  })()}
                </div>
                <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>
                  {lim.country} · Pakiet: {lim.pkg} · Ważny do: {lim.pkgExpiry}
                  {firmCo?.preconnect_enabled === false && firmCo?.account_status === "active" && <span style={{ color:"#d97706",marginLeft:6 }}>· PreConnect off</span>}
                  {firmCo?.fm_b2b_enabled && <span style={{ color:"#0d9488",marginLeft:6 }}>· FM B2B</span>}
                </div>
              </div>
              <div style={{ textAlign:"right",flexShrink:0 }}>
                <div style={{ fontWeight:700,fontSize:16,color:pct>=90?"#dc2626":pct>=70?"#d97706":"#059669" }}>{used}/{lim.max}</div>
                <div style={{ fontSize:10,color:"#94a3b8" }}>wysyłek</div>
              </div>
              <span style={{ fontSize:16,color:"#94a3b8",marginLeft:8 }}>{isExpanded?"▲":"▼"}</span>
            </div>
            {isExpanded&&(
              <div style={{ padding:"0 16px 16px",borderTop:"1px solid #f1f5f9" }}>
                {/* [B2B Round supplier-onboarding-access-and-communication]
                    Sekcja statusu konta + dwie flagi dostępu (PreConnect, Spotkania B2B).
                    To jest najważniejsze dla admina po rozwinięciu — dlatego idzie NA GÓRĘ
                    expanded view, przed pakietem i AI opisem. */}
                {firmCo?.name && setCompanies && (() => {
                  const status = firmCo.account_status || "active";
                  const [statusLbl, statusColor, statusBg] = ACCOUNT_STATUS_LABELS[status] || ACCOUNT_STATUS_LABELS.active;
                  const isPending = status === "pending_review";
                  const isSaving = savingStatusId === firmCo.id;
                  const note = statusNoteDraft[firmCo.id] ?? (firmCo.status_note || "");
                  return (
                    <div style={{ background:"#f8fafc",borderRadius:8,padding:"12px 14px",margin:"14px 0 12px",border:"1px solid #e2e8f0" }}>
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                        <div style={{ fontWeight:700,fontSize:12,color:"#334155",display:"flex",alignItems:"center",gap:8 }}>
                          Status & dostęp
                          <span style={{ fontSize:10,color:statusColor,background:statusBg,padding:"2px 8px",borderRadius:4,fontWeight:700 }}>{statusLbl}</span>
                          {firmCo.approved_at && status === "active" && <span style={{ fontSize:10,color:"#94a3b8" }}>· od {String(firmCo.approved_at).slice(0,10)}</span>}
                        </div>
                      </div>
                      {/* Pole notatki (powód odrzucenia/zawieszenia, lub komentarz aktywacji) */}
                      {(isPending || status === "rejected" || status === "suspended") && (
                        <textarea
                          value={note}
                          onChange={(e) => setStatusNoteDraft((prev) => ({ ...prev, [firmCo.id]: e.target.value }))}
                          placeholder="Notatka dla supplera (powód odrzucenia/zawieszenia, instrukcja co poprawić). Pojawi się w mailu."
                          style={{ width:"100%",padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit",resize:"vertical",minHeight:48,marginBottom:10,boxSizing:"border-box" }}
                        />
                      )}
                      {/* Akcje statusu — różne zestawy w zależności od stanu */}
                      <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:12 }}>
                        {isPending && (
                          <>
                            <Btn sm primary onClick={()=>changeAccountStatus(firmCo, "active")} disabled={isSaving} style={{ background:"#059669",color:"white",border:"none" }}>✓ Zatwierdź konto</Btn>
                            <Btn sm onClick={()=>changeAccountStatus(firmCo, "rejected")} disabled={isSaving} style={{ background:"#dc2626",color:"white",border:"none" }}>Odrzuć</Btn>
                          </>
                        )}
                        {status === "active" && (
                          <Btn sm outline onClick={()=>changeAccountStatus(firmCo, "suspended")} disabled={isSaving} style={{ color:"#dc2626",borderColor:"#fecaca" }}>Wstrzymaj konto</Btn>
                        )}
                        {(status === "rejected" || status === "suspended") && (
                          <Btn sm primary onClick={()=>changeAccountStatus(firmCo, "active")} disabled={isSaving} style={{ background:"#059669",color:"white",border:"none" }}>Aktywuj ponownie</Btn>
                        )}
                      </div>
                      {/* Dwie niezależne flagi dostępu — admin ustawia osobno */}
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                        <label style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:firmCo.preconnect_enabled?"rgba(13,148,136,0.06)":"white",border:`1px solid ${firmCo.preconnect_enabled?"#0d9488":"#e2e8f0"}`,borderRadius:7,cursor:"pointer",fontSize:12 }}>
                          <input type="checkbox" checked={!!firmCo.preconnect_enabled} onChange={(e) => toggleAccessFlag(firmCo, "preconnect_enabled", e.target.checked)} />
                          <div>
                            <div style={{ fontWeight:600,color:"#0f172a" }}>PreConnect</div>
                            <div style={{ color:"#64748b",fontSize:10 }}>Wysyłka ofert do sieci</div>
                          </div>
                        </label>
                        <label style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:firmCo.fm_b2b_enabled?"rgba(124,58,237,0.06)":"white",border:`1px solid ${firmCo.fm_b2b_enabled?"#7c3aed":"#e2e8f0"}`,borderRadius:7,cursor:"pointer",fontSize:12 }}>
                          <input type="checkbox" checked={!!firmCo.fm_b2b_enabled} onChange={(e) => toggleAccessFlag(firmCo, "fm_b2b_enabled", e.target.checked)} />
                          <div>
                            <div style={{ fontWeight:600,color:"#0f172a" }}>Spotkania B2B</div>
                            <div style={{ color:"#64748b",fontSize:10 }}>Fresh Market 2026</div>
                          </div>
                        </label>
                      </div>
                    </div>
                  );
                })()}
                <div style={{ margin:"14px 0 10px",background:"#f8fafc",borderRadius:8,padding:"10px 14px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:12 }}>
                    <span style={{ color:"#64748b" }}>Wykorzystanie pakietu</span>
                    <span style={{ fontWeight:700,color:pct>=90?"#dc2626":pct>=70?"#d97706":"#059669" }}>{pct}% ({used}/{lim.max})</span>
                  </div>
                  <div style={{ background:"#e2e8f0",borderRadius:4,height:6,overflow:"hidden" }}>
                    <div style={{ height:"100%",borderRadius:4,width:`${Math.min(100,pct)}%`,background:pct>=90?"#dc2626":pct>=70?"#d97706":"#059669" }}/>
                  </div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12 }}>
                  <div>
                    <label style={{ fontSize:10,color:"#94a3b8",display:"block",marginBottom:3 }}>LIMIT WYSYŁEK</label>
                    <input type="number" value={lim.max} onChange={e=>updateLimit(lim.id,{max:+e.target.value})}
                      style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" }}/>
                  </div>
                  <div>
                    <label style={{ fontSize:10,color:"#94a3b8",display:"block",marginBottom:3 }}>PAKIET</label>
                    <select value={lim.pkg} onChange={e=>updateLimit(lim.id,{pkg:e.target.value})}
                      style={{ width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:13,fontFamily:"inherit",boxSizing:"border-box" }}>
                      <option value="std_10">Standard 10</option>
                      <option value="std_20">Standard 20</option>
                      <option value="prem_10">Premium 10</option>
                      <option value="prem_20">Premium 20</option>
                    </select>
                  </div>
                </div>
                {/* [B2B Round adaptive-company-profile-ai] AI review block ─ */}
                {firmCo?.name && setCompanies && (() => {
                  const status = firmCo.ai_review_status || "pending";
                  const [statusLabel, statusColor, statusBg] = reviewLabel[status] || reviewLabel.pending;
                  const isEditing = editingId === firmCo.id;
                  const isLoading = aiLoadingId === firmCo.id;
                  return (
                    <div style={{ background:"#f8fafc",borderRadius:8,padding:"12px 14px",marginBottom:12,border:"1px solid #e2e8f0" }}>
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                          <Bot size={14} color="#3b82f6"/>
                          <strong style={{ fontSize:12 }}>Opis AI</strong>
                          <span style={{ fontSize:10,color:statusColor,background:statusBg,padding:"2px 7px",borderRadius:4,fontWeight:600 }}>{statusLabel}</span>
                        </div>
                        <div style={{ display:"flex",gap:6 }}>
                          <Btn sm outline onClick={()=>setPreviewCompany(firmCo)}><Eye size={11}/> Podgląd</Btn>
                          {!isEditing && (
                            <>
                              <Btn sm outline onClick={()=>startEdit(firmCo)}>Edytuj</Btn>
                              <Btn sm outline onClick={()=>regenerateForCompany(firmCo)} disabled={isLoading}>
                                {isLoading ? <RefreshCw size={11} style={{ animation:"spin 1s linear infinite" }}/> : <Sparkles size={11}/>}
                                {isLoading ? " Generuję…" : " Generuj AI"}
                              </Btn>
                              {status !== "approved" && <Btn sm primary onClick={()=>approveDescriptions(firmCo)}>Zatwierdź</Btn>}
                            </>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <>
                          <Inp
                            label="Opis krótki"
                            ta
                            value={editDraft.description_short}
                            onChange={e=>setEditDraft(d=>({ ...d, description_short: e.target.value }))}
                            style={{ minHeight:50,fontSize:12 }}
                          />
                          <Inp
                            label="Opis standardowy"
                            ta
                            value={editDraft.description}
                            onChange={e=>setEditDraft(d=>({ ...d, description: e.target.value }))}
                            style={{ fontSize:12 }}
                          />
                          <div style={{ display:"flex",gap:6,justifyContent:"flex-end" }}>
                            <Btn sm outline onClick={cancelEdit}>Anuluj</Btn>
                            <Btn sm primary onClick={()=>saveEdit(firmCo)}>Zapisz</Btn>
                          </div>
                        </>
                      ) : (
                        <>
                          {firmCo.description_short ? (
                            <div style={{ fontSize:12,color:"#334155",marginBottom:6 }}>
                              <span style={{ color:"#64748b",fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em" }}>Krótki:</span> {firmCo.description_short}
                            </div>
                          ) : null}
                          {firmCo.description ? (
                            <div style={{ fontSize:12,color:"#334155",lineHeight:1.6 }}>
                              <span style={{ color:"#64748b",fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em" }}>Standard:</span> {firmCo.description}
                            </div>
                          ) : null}
                          {!firmCo.description_short && !firmCo.description && (
                            <div style={{ fontSize:12,color:"#94a3b8",fontStyle:"italic" }}>Brak opisów. Kliknij „Generuj AI", aby utworzyć.</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
                <div style={{ fontSize:12,color:"#64748b",marginBottom:8 }}>
                  <strong>Wysyłki ({firmSends.length}):</strong> {firmSends.length===0?"Brak wysyłek.":""}
                </div>
                {firmSends.slice(-5).reverse().map(s=>{
                  const o=getOffer(s.offerId,offers); const r=getRetailerLive(s.retailerId);
                  return (
                    <div key={s.id} style={{ display:"flex",gap:8,alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:12 }}>
                      <span style={{ fontSize:14 }}>{CEMOJI[o?.category]||"📦"}</span>
                      <div style={{ flex:1 }}>{o?.title||o?.product||"Propozycja"} → {r?.name||"—"}</div>
                      <span title={STATUS_TIPS[s.status]||""} style={{ cursor:"help" }}>
                        <Badge color={STATUS_MAP[s.status]?.[1]}>{STATUS_MAP[s.status]?.[0]||s.status}</Badge>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {previewCompany && (
        <CompanyPreviewModal co={previewCompany} offers={offers} role="admin" onClose={()=>setPreviewCompany(null)}/>
      )}
    </div>
  );
}

// [B2B Round pipeline-retailer-email-mvp]
// Modal podglądu zbiorczego maila do JEDNEJ sieci + ręczna wysyłka.
//   - filtrujemy do `status==='approved'` (rejected / pending / queued nie idą)
//   - pokazujemy ile ofert + ilu kupców zostanie zaadresowanych
//   - "Wyślij" wywołuje /.netlify/functions/send-retailer-batch który
//     wysyła Resendem do każdego aktywnego kupca i ustawia status='sent'
//   - po sukcesie callback `onSent(markedIds, sentAt)` aktualizuje state
//     parenta — pozycje wysłane znikają z moderacji i pojawiają się w
//     zakładce "Wysłane & Tracking"
//   - guard anti-duplicate: button disabled w trakcie wysyłki + backend
//     ponownie waliduje status (żeby kliknięcie 2x na zafrozzonej karcie
//     nie wysłało dwa razy)
function EmailNewsletterModal({ retailer, sends, offers, companies, fl, onClose, onSent }) {
  const monthName = (() => {
    const months = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
    const d = new Date();
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  })();

  // Tylko zatwierdzone wchodzą do mailingu — inaczej kupiec dostałby
  // ofertę odrzuconą lub jeszcze niemoderowaną.
  const approvedSends = (sends || []).filter(s => s.status === "approved");
  const skippedCount = (sends || []).length - approvedSends.length;

  // Sortowanie: premium na górze, potem standard, w obu po `pos`.
  const premSends = approvedSends.filter(s => { const o = getOffer(s.offerId, offers); return o?.tier === "premium"; }).sort((a,b)=>(a.pos||99)-(b.pos||99));
  const stdSends  = approvedSends.filter(s => { const o = getOffer(s.offerId, offers); return o?.tier !== "premium"; }).sort((a,b)=>(a.pos||99)-(b.pos||99));
  const allSorted = [...premSends, ...stdSends];

  // Aktywni kupcy tej sieci — to do nich pójdą maile.
  const activeBuyers = (retailer?.buyers || []).filter(b =>
    b && b.role === "buyer" && b.active && b.email && String(b.email).includes("@")
  );

  // Helper: znajdź firmę dostawcy dla danej oferty (firmy są w state legacy
  // jako lista — szukamy po legacy_supplier_id / id / fmId).
  const findSupplierCo = (supplierId) => {
    if (!supplierId) return COMPANY_INIT;
    return (companies || []).find(c => legacyKeyMatchesCompany(supplierId, c)) || COMPANY_INIT;
  };

  const [sendingState, setSendingState] = useState("idle"); // idle | confirm | sending | success | error
  const [sendResult, setSendResult] = useState(null);

  const offerCount = allSorted.length;
  const buyerCount = activeBuyers.length;
  const subjectLine = `Fresh Market PreConnect – ${offerCount} ${offerCount === 1 ? "oferta" : offerCount < 5 ? "oferty" : "ofert"} dla ${retailer?.name || ""}`;
  const buyerLine = buyerCount === 1
    ? `Ta wiadomość trafi do 1 kupca z sieci ${retailer?.name || ""} i zawiera ${offerCount} ${offerCount===1?"ofertę":offerCount<5?"oferty":"ofert"}.`
    : `Ta wiadomość trafi do ${buyerCount} kupców sieci ${retailer?.name || ""} i zawiera ${offerCount} ${offerCount===1?"ofertę":offerCount<5?"oferty":"ofert"}.`;

  // Pusta sieć / brak ofert / brak kupców — pokaż komunikat zamiast pustego maila
  if (offerCount === 0) {
    return (
      <Modal title={`E-mail dla ${retailer?.name || "sieci"}`} onClose={onClose}>
        <Alrt type="warning">
          {skippedCount > 0
            ? <>Brak ofert <strong>zatwierdzonych</strong> dla tej sieci. {skippedCount} pozycji jest w innym statusie (do moderacji / odrzucona / wysłana). Najpierw zatwierdź propozycje w Pipeline.</>
            : <>Ta sieć nie ma żadnych propozycji w kolejce.</>
          }
        </Alrt>
        <div style={{ display:"flex",justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={onClose}>Zamknij</Btn>
        </div>
      </Modal>
    );
  }
  if (buyerCount === 0) {
    return (
      <Modal title={`E-mail dla ${retailer?.name || "sieci"}`} onClose={onClose}>
        <Alrt type="warning">
          Sieć <strong>{retailer?.name}</strong> nie ma aktywnego kupca z e-mailem. Najpierw dodaj kupca w „Sieci" → wybierz tę sieć → „Kupcy".
        </Alrt>
        <div style={{ display:"flex",justifyContent:"flex-end",marginTop:12 }}>
          <Btn outline onClick={onClose}>Zamknij</Btn>
        </div>
      </Modal>
    );
  }

  async function doSend() {
    setSendingState("sending");
    setSendResult(null);
    try {
      const result = await dbSendRetailerBatch({
        retailer_id: retailer.id,
        send_ids: allSorted.map(s => Number(s.id)).filter(Number.isFinite),
      });
      setSendResult(result);
      if (result.ok) {
        setSendingState("success");
        const sentAt = new Date().toISOString().slice(0, 10);
        onSent?.(result.send_ids_marked || [], sentAt);
        const failedCount = (result.buyers_failed || []).length;
        if (failedCount > 0) {
          fl?.(`Wysłano do ${result.buyer_count - failedCount}/${result.buyer_count} kupców · ${result.send_ids_marked?.length || 0} ofert oznaczonych jako wysłane. ${failedCount} buyer(ów) nie udało się.`, "warning");
        } else {
          fl?.(`Wysłano! ${result.buyer_count} kupiec(ów) · ${result.send_ids_marked?.length || 0} ofert oznaczonych jako wysłane.`);
        }
        // Auto-close po 1.5s
        setTimeout(() => onClose?.(), 1500);
      } else {
        setSendingState("error");
        fl?.(result.error || "Wysyłka nie powiodła się.", "warning");
      }
    } catch (e) {
      console.warn("[sendRetailerBatch]", e);
      setSendResult(e?.payload || { error: e?.message });
      setSendingState("error");
      fl?.(e?.message || "Nie udało się wysłać maila.", "warning");
    }
  }

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:9999,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"16px",overflowY:"auto" }}>
      <div style={{ background:"#f1f5f9",borderRadius:16,width:"100%",maxWidth:660,boxShadow:"0 24px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 18px",background:"#1e3a5f",borderRadius:"16px 16px 0 0" }}>
          <div style={{ flex:1 }}>
            <div style={{ color:"white",fontWeight:700,fontSize:14 }}>E-mail dla {retailer?.name}</div>
            <div style={{ fontSize:11,color:"rgba(255,255,255,0.55)",marginTop:2 }}>{buyerLine}</div>
          </div>
          {sendingState === "success"
            ? <span style={{ background:"#10b981",color:"white",fontSize:12,fontWeight:700,padding:"6px 12px",borderRadius:7 }}>✓ Wysłano</span>
            : <>
                <Btn sm onClick={onClose} disabled={sendingState === "sending"} style={{ background:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",border:"1px solid rgba(255,255,255,0.2)" }}>Anuluj</Btn>
                <Btn sm onClick={doSend} disabled={sendingState === "sending"} style={{ background:"#10b981",color:"white",border:"none",fontWeight:700 }}>
                  {sendingState === "sending"
                    ? <><RefreshCw size={12} style={{ animation:"spin 1s linear infinite" }}/> Wysyłam…</>
                    : <><Send size={12}/> Wyślij ({offerCount})</>
                  }
                </Btn>
              </>
          }
        </div>
        <div style={{ background:"#dde3ea",padding:"8px 14px",borderBottom:"1px solid #b8c4ce" }}>
          {[
            ["Od", "Fresh Market <newsletter@freshmarket.eu>"],
            ["Do", activeBuyers.map(b => `${b.name || b.email} <${b.email}>`).join(", ")],
            ["Temat", subjectLine],
          ].map(([k,v])=>(
            <div key={k} style={{ display:"flex",gap:8,padding:"3px 0",fontSize:12 }}>
              <span style={{ color:"#64748b",minWidth:40,fontWeight:600 }}>{k}:</span>
              <span style={{ color:"#1e293b",flex:1,wordBreak:"break-word" }}>{v}</span>
            </div>
          ))}
          {skippedCount > 0 && (
            <div style={{ marginTop:6,fontSize:11,color:"#92400e",background:"#fef3c7",border:"1px solid #fde68a",padding:"5px 10px",borderRadius:6 }}>
              Pominięto {skippedCount} {skippedCount===1?"propozycję":skippedCount<5?"propozycje":"propozycji"} (nie są zatwierdzone — odrzucone, w moderacji lub już wysłane).
            </div>
          )}
        </div>
        <div style={{ background:"#ececec",padding:"20px 12px",overflowY:"auto",maxHeight:"calc(100vh - 180px)" }}>
          <div style={{ maxWidth:600,margin:"0 auto",fontFamily:"'Arial',Helvetica,sans-serif",fontSize:14,color:"#1a1a1a",lineHeight:1.5 }}>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ borderRadius:"12px 12px 0 0",overflow:"hidden" }}>
              <tbody><tr><td style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0d9488 100%)",padding:"28px 32px",textAlign:"center" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10 }}>
                  <span style={{ fontSize:24 }}>🍎</span>
                  <span style={{ color:"white",fontWeight:800,fontSize:22,letterSpacing:"-0.5px" }}>Fresh Market</span>
                  <span style={{ color:"rgba(255,255,255,0.35)",fontSize:12 }}>Preconnect</span>
                </div>
                <div style={{ color:"rgba(255,255,255,0.95)",fontSize:22,fontWeight:700,marginBottom:6 }}>Propozycje Preconnect – {monthName}</div>
                <div style={{ color:"rgba(255,255,255,0.5)",fontSize:13 }}>Mailing dedykowany dla <strong style={{ color:"rgba(255,255,255,0.85)" }}>{retailer?.name}</strong></div>
              </td></tr></tbody>
            </table>
            <div style={{ background:"white",padding:"20px 28px 16px",borderLeft:"4px solid #0d9488",borderRight:"4px solid #0d9488" }}>
              <p style={{ margin:"0 0 10px",color:"#334155",lineHeight:1.75 }}>Szanowna Pani / Szanowny Panie,</p>
              <p style={{ margin:"0 0 10px",color:"#334155",lineHeight:1.75 }}>przesyłamy <strong>{allSorted.length} {allSorted.length===1?"propozycję produktu":allSorted.length<5?"propozycje produktów":"propozycji produktów"}</strong> wyselekcjonowanych przez zespół Fresh Market dla kategorii zakupowej <strong>{retailer?.name}</strong>.</p>
              <p style={{ margin:0,fontSize:13,color:"#94a3b8" }}>Kliknij przycisk przy wybranej propozycji, aby skontaktować się bezpośrednio z dostawcą.</p>
            </div>
            {premSends.length>0&&(
              <div style={{ background:"linear-gradient(90deg,#fffbeb,#fef3c7)",borderLeft:"4px solid #fbbf24",borderRight:"4px solid #fbbf24",padding:"8px 20px",display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ fontSize:14 }}>⭐</span>
                <span style={{ fontSize:11,fontWeight:700,color:"#92400e",textTransform:"uppercase",letterSpacing:0.8 }}>Propozycje wyróżnione – pozycja TOP</span>
              </div>
            )}
            {allSorted.map((s,idx)=>{
              const o=getOffer(s.offerId,offers); if(!o) return null;
              const isPrem=o.tier==="premium";
              const isFirstStd=idx===premSends.length && stdSends.length>0;
              const allCerts=[...(o.certs||[]),o.customCert].filter(Boolean);
              const allPack=[...(o.packaging||[]),o.customPackaging].filter(Boolean);
              const descParts=(o.description||"").split(/(\*\*[^*]+\*\*)/g);
              // [B2B Round pipeline-retailer-email-mvp] Per-offer supplier lookup —
              // wcześniej był jeden `sCo` dla wszystkich, co dla maila zbiorczego
              // (oferty od wielu firm) pokazywałoby błędną firmę.
              const co = findSupplierCo(s.supplierId);
              return (
                <div key={s.id}>
                  {isFirstStd&&premSends.length>0&&(
                    <div style={{ background:"#f0f4f8",borderLeft:"4px solid #e2e8f0",borderRight:"4px solid #e2e8f0",padding:"8px 20px" }}>
                      <span style={{ fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8 }}>Pozostałe propozycje</span>
                    </div>
                  )}
                  <div style={{ background:"white",borderLeft:`4px solid ${isPrem?"#fbbf24":"#e2e8f0"}`,borderRight:`4px solid ${isPrem?"#fbbf24":"#e2e8f0"}`,borderBottom:"1px solid #f1f5f9",padding:"18px 24px" }}>
                    <div style={{ display:"flex",gap:10,alignItems:"flex-start",marginBottom:12 }}>
                      {co?.logo
                        ? <img src={co.logo} alt={co.name||""} style={{ width:42,height:42,borderRadius:8,objectFit:"contain",background:"white",border:"1px solid #e2e8f0",padding:2,flexShrink:0 }}/>
                        : <div style={{ width:42,height:42,borderRadius:8,background:"#f1f5f9",color:"#64748b",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>{(co?.name||"•").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</div>
                      }
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2 }}>{co?.name || "Dostawca Fresh Market"}</div>
                        <div style={{ fontWeight:700,fontSize:16,color:"#0f172a",lineHeight:1.3 }}>{o.title||o.product}</div>
                        <div style={{ fontSize:12,color:"#64748b",marginTop:3 }}>{FLAGS[o.origin]||"🌐"} {CNAMES[o.origin]||o.origin} · pozycja {s.pos||idx+1} · {o.volume} {o.volumeUnit}</div>
                      </div>
                      {isPrem&&<span style={{ background:"#d97706",color:"white",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",flexShrink:0 }}>⭐ PREMIUM</span>}
                    </div>
                    {Array.isArray(o.photos)&&o.photos[0]&&(
                      <div style={{ marginBottom:12 }}>
                        <img src={typeof o.photos[0]==="string"?o.photos[0]:o.photos[0].url} alt="" style={{ width:"100%",maxWidth:552,height:"auto",borderRadius:8,border:"1px solid #f1f5f9",display:"block" }}/>
                      </div>
                    )}
                    <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:12 }}>
                      {[["Wolumen",`${o.volume} ${o.volumeUnit}`],["Min. zamówienie",o.minOrder||"—"],o.from&&["Dostępność",`${o.from.slice(0,7)}–${o.to?.slice(0,7)||"?"}`],allPack.length>0&&["Opakowanie",allPack.slice(0,2).join(", ")]].filter(Boolean).map(([lbl,val])=>(
                        <div key={lbl} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,padding:"5px 10px",flex:"1 1 100px" }}>
                          <div style={{ fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:0.5 }}>{lbl}</div>
                          <div style={{ fontWeight:700,fontSize:12,color:"#1e293b",marginTop:1 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                    {allCerts.length>0&&<div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:12 }}>{allCerts.map(c=><span key={c} style={{ background:"#d1fae5",color:"#047857",fontSize:11,fontWeight:600,padding:"2px 9px",borderRadius:20,border:"1px solid #6ee7b7" }}>✓ {c}</span>)}</div>}
                    {o.description&&(
                      <div style={{ fontSize:13,color:"#475569",lineHeight:1.8,marginBottom:16,padding:"10px 14px",background:isPrem?"#fffbeb":"#f8fafc",borderRadius:7,borderLeft:`3px solid ${isPrem?"#fbbf24":"#e2e8f0"}` }}>
                        {descParts.map((part,i)=>{ const m=part.match(/^\*\*([^*]+)\*\*$/); return m?<strong key={i} style={{ fontWeight:700,color:"#1e293b",display:"block",marginTop:i>0?4:0 }}>{m[1]}</strong>:<span key={i} style={{ whiteSpace:"pre-line" }}>{part}</span>; })}
                      </div>
                    )}
                    <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                      <div style={{ flex:1,padding:"8px 10px",background:"#f1f5f9",borderRadius:7,fontSize:11 }}>
                        <div style={{ fontWeight:700,color:"#1e293b",marginBottom:1 }}>{co?.name||"—"}{co?.country?<> · {FLAGS[co.country]} {CNAMES[co.country]||co.country}</>:null}</div>
                        {co?.description_short && <div style={{ color:"#475569",fontSize:11,marginTop:2 }}>{co.description_short}</div>}
                      </div>
                      <div style={{ flexShrink:0 }}>
                        <div style={{ background:isPrem?"#d97706":"#0d9488",color:"white",padding:"9px 18px",borderRadius:7,fontWeight:700,fontSize:12,textAlign:"center" }}>
                          {o.cta?.includes("samples")?"Poproś o próbki":o.cta?.includes("rfq")?"Zapytaj o cenę":o.cta?.includes("meet_fm")?"Umów spotkanie":"Zobacz ofertę"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ background:"#0f172a",borderRadius:"0 0 12px 12px",padding:"20px 28px",textAlign:"center" }}>
              <div style={{ color:"rgba(255,255,255,0.9)",fontWeight:700,fontSize:14,marginBottom:6 }}>🍎 Fresh Market Preconnect</div>
              <div style={{ color:"rgba(255,255,255,0.4)",fontSize:11,lineHeight:1.9 }}>
                KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska<br/>
                freshmarket.eu · newsletter@freshmarket.eu · +48 603 424 346
              </div>
              <div style={{ marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.08)",fontSize:10,color:"rgba(255,255,255,0.2)",lineHeight:1.7 }}>
                Otrzymałeś ten e-mail, ponieważ jesteś zarejestrowany w programie Fresh Market Preconnect jako kupiec sieci {retailer?.name}.
                © {new Date().getFullYear()} KJOW Sp. z o.o. Wszelkie prawa zastrzeżone.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmForm({ send, onConfirm }) {
  const [note,setNote]=useState(""); const [rt,setRt]=useState("manual_phone");
  return (
    <div style={{ marginTop:10,padding:"12px 14px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0" }}>
      <div style={{ fontSize:12,color:"#64748b",marginBottom:8 }}>Kontakt ręczny z kupcem:</div>
      <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:8 }}>{[["manual_phone","Telefon"],["manual_email","E-mail"],["manual_meeting","Spotkanie"]].map(([v,l])=>(
        <span key={v} onClick={()=>setRt(v)} style={{ padding:"4px 10px",border:`2px solid ${rt===v?"#0891b2":"#e2e8f0"}`,borderRadius:7,fontSize:12,cursor:"pointer",background:rt===v?"rgba(8,145,178,0.05)":"white",fontWeight:rt===v?600:400,userSelect:"none" }}>{l}</span>
      ))}</div>
      <Inp label="Notatka" ta value={note} onChange={e=>setNote(e.target.value)} style={{ minHeight:48 }}/>
      <Btn primary sm onClick={()=>{ onConfirm(send.id,rt,note); setNote(""); setRt("manual_phone"); }}>Zapisz potwierdzenie</Btn>
    </div>
  );
}

// [B2B Round adaptive-company-profile-ai]
// Profil rozłożony na warstwy. Tier 1 (zawsze widoczny) — logo, nazwa, kraj,
// krótki opis, typy, kategorie. Tier 2 (tylko jeśli są dane) — rynki,
// zaplecze, materiały, certyfikaty, pitch, pełny opis. Pusta sekcja
// ZNIKA — kupiec nie czyta nagłówków bez treści.
const PARTNERSHIP_LABELS = {
  programy_stale: "Programy stałe",
  spot: "Spot",
  promocje: "Promocje",
  sezonowe_akcje: "Sezonowe akcje",
};
const CAPABILITY_LABELS = {
  sortownia: "Sortownia",
  pakowalnia: "Pakowalnia",
  chlodnia: "Chłodnia",
  linia_optyczna: "Linia optyczna",
  etykietowanie: "Etykietowanie",
  konfekcjonowanie: "Konfekcjonowanie",
  retail_ready: "Retail-ready",
  wlasna_logistyka: "Własna logistyka",
  partner_logistyczny: "Partner logistyczny",
};
const CUSTOMER_TYPE_LABELS = {
  retail: "Retail",
  wholesale: "Hurt",
  horeca: "HoReCa",
  processing: "Przetwórstwo",
  export: "Eksport",
};

function ProfileSection({ title, icon: Ic, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"#64748b" }}>
        {Ic && <Ic size={12} color="#0d9488"/>}
        <span>{title}</span>
      </div>
      <div style={{ fontSize:13,color:"#334155",lineHeight:1.55 }}>{children}</div>
    </div>
  );
}

function CompanyPreviewModal({ co, onClose, offers, sends, buyerRetailerId, role }) {
  const pd = co.profile_data || {};
  const basics = pd.basics || {};
  const offer = pd.offer || {};
  const trade = pd.trade || {};
  const ops = pd.operations || {};
  const materials = Array.isArray(pd.materials) ? pd.materials : [];
  const supplierPitch = (typeof pd.supplier_pitch === "string" ? pd.supplier_pitch : "").trim();
  const exportCountries = Array.isArray(trade.export_countries) ? trade.export_countries.filter(Boolean) : [];
  const partnershipTypes = Array.isArray(trade.partnership_types) ? trade.partnership_types.filter(Boolean) : [];
  const capabilities = Array.isArray(ops.capabilities) ? ops.capabilities.filter(Boolean) : [];
  const customerTypes = Array.isArray(offer.customer_types) ? offer.customer_types.filter(Boolean) : [];
  const certs = Array.isArray(co.certs) ? co.certs.filter(Boolean) : [];

  const shortDesc = (co.description_short || "").trim();
  const longDesc = (co.description || "").trim();
  // Jeśli są oba — krótki na górze (tier 1), pełny niżej (tier 2). Jeśli
  // jest tylko jeden, pokaż go raz w tier 1.
  const tier1Desc = shortDesc || longDesc || "";
  const tier2Desc = shortDesc && longDesc && shortDesc !== longDesc ? longDesc : "";

  const hasMarkets = exportCountries.length > 0 || partnershipTypes.length > 0 || trade.main_markets || trade.typical_volumes || co.markets;
  const hasOps = capabilities.length > 0;
  const hasOffer = offer.products_year_round || offer.products_seasonal || customerTypes.length > 0 || offer.private_label;
  const hasMaterials = materials.length > 0;
  const hasCerts = certs.length > 0;

  return (
    <Modal title="Podgląd profilu firmy – widok kupca" onClose={onClose} wide>
      {/* ── TIER 1 ── zawsze widoczny: logo, nazwa, kraj, opis krótki, typy ── */}
      <div style={{ display:"flex",gap:14,marginBottom:14,padding:14,background:"#f8fafc",borderRadius:10 }}>
        {co.logo?<img src={co.logo} alt="" style={{ width:70,height:70,objectFit:"contain",borderRadius:10,flexShrink:0,background:"white",border:"1px solid #e2e8f0",padding:4 }}/>:<div style={{ width:70,height:70,borderRadius:10,background:"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Building2 size={28} color="#94a3b8"/></div>}
        <div style={{ flex:1 }}>
          <h3 style={{ margin:"0 0 3px" }}>{co.name}</h3>
          <div style={{ fontSize:12,color:"#64748b" }}>
            {FLAGS[co.country]||"🌐"} {CNAMES[co.country]||co.country}
            {co.city && <> · {co.city}</>}
            {co.nip && <> · {co.nip}</>}
            {basics.founded_year && <> · od {basics.founded_year}</>}
            {basics.employees && <> · {basics.employees} pracowników</>}
          </div>
          {co.website&&<div style={{ fontSize:12,color:"#3b82f6",marginTop:2 }}>{co.website}</div>}
          <div style={{ marginTop:7,display:"flex",gap:4,flexWrap:"wrap" }}>
            {(co.types||[]).map(t=><Badge key={t} color="#0d9488">{TYPE_LABELS[t]||t}</Badge>)}
            {(co.categories||[]).map(t=><Badge key={`c-${t}`} color="#65a30d" bg="#f7fee7">{CEMOJI[t]||""} {t}</Badge>)}
          </div>
        </div>
      </div>
      {tier1Desc
        ? <p style={{ color:"#1e293b",lineHeight:1.65,marginBottom:14,fontSize:13.5,fontWeight:500 }}>{tier1Desc}</p>
        : <div style={{ fontSize:12,color:"#94a3b8",fontStyle:"italic",marginBottom:14 }}>Firma nie dodała jeszcze opisu.</div>
      }
      {/* ── TIER 2 ── widoczne tylko, jeśli supplier coś podał ─────────────── */}
      {(hasOffer || hasMarkets || hasOps || hasCerts || hasMaterials || tier2Desc || supplierPitch) && (
        <div style={{ borderTop:"1px solid #e2e8f0",paddingTop:14 }}>
          {hasOffer && (
            <ProfileSection title="Oferta" icon={Tag}>
              {offer.products_year_round && <div><strong style={{ color:"#0d9488" }}>Całoroczne:</strong> {offer.products_year_round}</div>}
              {offer.products_seasonal && <div><strong style={{ color:"#0d9488" }}>Sezonowe:</strong> {offer.products_seasonal}</div>}
              {customerTypes.length > 0 && (
                <div style={{ marginTop:5,display:"flex",gap:4,flexWrap:"wrap" }}>
                  {customerTypes.map(t=><Badge key={t} color="#0891b2" bg="#ecfeff">{CUSTOMER_TYPE_LABELS[t]||t}</Badge>)}
                </div>
              )}
              {offer.private_label && <div style={{ marginTop:5,fontSize:12,color:"#059669" }}>✓ Marka własna / private label</div>}
            </ProfileSection>
          )}
          {hasMarkets && (
            <ProfileSection title="Rynki i handel" icon={Send}>
              {exportCountries.length > 0 && (
                <div style={{ marginBottom:4 }}>
                  <strong style={{ color:"#0d9488" }}>Eksport: </strong>
                  {exportCountries.map(cc => `${FLAGS[cc]||"🌐"} ${CNAMES[cc]||cc}`).join(" · ")}
                </div>
              )}
              {trade.main_markets && <div><strong style={{ color:"#0d9488" }}>Główne rynki:</strong> {trade.main_markets}</div>}
              {co.markets && !trade.main_markets && <div><strong style={{ color:"#0d9488" }}>Rynki:</strong> {co.markets}</div>}
              {trade.typical_volumes && <div><strong style={{ color:"#0d9488" }}>Wolumeny:</strong> {trade.typical_volumes}</div>}
              {partnershipTypes.length > 0 && (
                <div style={{ marginTop:5,display:"flex",gap:4,flexWrap:"wrap" }}>
                  {partnershipTypes.map(t=><Badge key={t} color="#7c3aed" bg="#f3f0ff">{PARTNERSHIP_LABELS[t]||t}</Badge>)}
                </div>
              )}
            </ProfileSection>
          )}
          {hasOps && (
            <ProfileSection title="Zaplecze operacyjne" icon={ShieldCheck}>
              <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
                {capabilities.map(t=><Badge key={t} color="#0d9488" bg="#ccfbf1">{CAPABILITY_LABELS[t]||t}</Badge>)}
              </div>
            </ProfileSection>
          )}
          {hasCerts && (
            <ProfileSection title="Certyfikaty" icon={ShieldCheck}>
              {certs.map((ct,i)=>(
                <div key={i} style={{ display:"flex",gap:10,padding:"7px 12px",background:"#f0fdf4",borderRadius:7,marginBottom:5,fontSize:13,border:"1px solid #bbf7d0" }}>
                  <ShieldCheck size={13} color="#059669"/>
                  <strong style={{ color:"#0d9488" }}>{ct.type}</strong>
                  {ct.number && <span style={{ color:"#64748b" }}>Nr: {ct.number}</span>}
                  {ct.valid && <span style={{ marginLeft:"auto",color:"#059669" }}>do {ct.valid}</span>}
                </div>
              ))}
            </ProfileSection>
          )}
          {hasMaterials && (
            <ProfileSection title="Materiały" icon={Award}>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(120px, 1fr))",gap:8 }}>
                {materials.map(url => {
                  const isPdf = /\.pdf(\?|$)/i.test(url);
                  return (
                    <a key={url} href={url} target="_blank" rel="noreferrer" style={{ display:"block",aspectRatio:"4/3",borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0",background:"#f8fafc",position:"relative",textDecoration:"none" }}>
                      {isPdf
                        ? <div style={{ width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#3b82f6",fontSize:11,fontWeight:600 }}><span style={{ fontSize:28 }}>📄</span><span>PDF</span></div>
                        : <img src={url} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/>
                      }
                    </a>
                  );
                })}
              </div>
            </ProfileSection>
          )}
          {tier2Desc && (
            <ProfileSection title="Pełny opis" icon={Building2}>
              <p style={{ color:"#475569",lineHeight:1.7,margin:0 }}>{tier2Desc}</p>
            </ProfileSection>
          )}
          {supplierPitch && (
            <ProfileSection title="Co podkreśla firma" icon={Sparkles}>
              <div style={{ padding:"10px 12px",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,fontSize:13,color:"#78350f",fontStyle:"italic" }}>
                {supplierPitch}
              </div>
            </ProfileSection>
          )}
        </div>
      )}
      {(co.contacts||[]).length > 0 && (
        <div style={{ borderTop:"1px solid #e2e8f0",paddingTop:14,marginTop:6 }}>
          <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"#64748b",marginBottom:6 }}>Kontakty</div>
          {(co.contacts||[]).map((ct,i)=><div key={i} style={{ padding:10,background:"#f8fafc",borderRadius:7,marginBottom:7,border:"1px solid #e2e8f0" }}><div style={{ fontWeight:600,fontSize:13 }}>{ct.name}</div><div style={{ fontSize:12,color:"#64748b" }}>{ct.position} · {ct.phone} · {ct.email}</div></div>)}
        </div>
      )}
      {offers!==undefined&&(
        <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid #e2e8f0"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
            <Tag size={13} color="#0d9488"/> Aktywne propozycje
          </div>
          {(()=>{
            const coOffers = (() => {
                if (role==="buyer") {
                  // Strict privacy: only show offers sent to this buyer's retailer
                  if (!buyerRetailerId) {
                    // No retailer mapping -> show nothing (privacy: prevent full catalog leak)
                    return "__no_retailer__";
                  }
                  const sentOfferIds = new Set(
                    (sends||[]).filter(s=>s.retailerId===buyerRetailerId)
                               .map(s=>s.offerId)
                  );
                  return (offers||[]).filter(o=>
                    legacyKeyMatchesCompany(o.supplierId, co) && o.status==="active" && sentOfferIds.has(o.id)
                  );
                }
                // Supplier or admin: show all active offers of this company
                return (offers||[]).filter(o=>legacyKeyMatchesCompany(o.supplierId, co)&&o.status==="active");
              })();
            if(coOffers==="__no_retailer__") return <div style={{fontSize:12,color:"#94a3b8",padding:"12px",background:"#f8fafc",borderRadius:8,textAlign:"center"}}>Brak przypisanej sieci detalicznej — podgląd propozycji niedostępny.</div>;
            if(coOffers.length===0) return <div style={{fontSize:12,color:"#94a3b8",padding:"12px",background:"#f8fafc",borderRadius:8,textAlign:"center"}}>Brak aktywnych propozycji w tej chwili.</div>;
            const safeOffers = Array.isArray(coOffers) ? coOffers : [];
            return <div style={{display:"flex",flexDirection:"column",gap:8}}>{safeOffers.map(o=>(
              <div key={o.id} style={{display:"flex",gap:10,alignItems:"center",padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
                <span style={{fontSize:18}}>{CEMOJI[o.category]||"📦"}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.title||o.product}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:1}}>{FLAGS[o.origin]||"🌐"} {CNAMES[o.origin]||o.origin}{o.volume?` · ${o.volume} ${o.volumeUnit||""}`:""}
                  </div>
                </div>
                {o.tier==="premium"&&<Badge color="#d97706" bg="#fef3c7">Premium</Badge>}
              </div>
            ))}</div>;
          })()}
        </div>
      )}
    </Modal>
  );
}

function OfferPreviewModal({ offer, co, onClose }) {
  if(!offer) return null;
  const allCerts=[...(offer.certs||[]),offer.customCert].filter(Boolean);
  const allPack=[...(offer.packaging||[]),offer.customPackaging].filter(Boolean);
  const ct=co?.contacts?.[0];
  return (
    <Modal title="Podgląd propozycji – widok kupca" onClose={onClose} wide>
      {offer.tier==="premium"&&<div style={{ background:"#fffbeb",border:"1px solid #fbbf24",borderRadius:7,padding:"6px 12px",marginBottom:10,fontSize:12,fontWeight:600,color:"#92400e",display:"flex",gap:5,alignItems:"center" }}><Star size={12} fill="#d97706" color="#d97706"/> Premium</div>}
      <div style={{ background:"#f0fdf4",borderRadius:10,padding:14,marginBottom:14,display:"flex",gap:12 }}>
        {offer.photos?.length?<img src={offer.photos[0]} alt="" style={{ width:110,height:80,objectFit:"cover",borderRadius:7,flexShrink:0,border:"2px solid #bbf7d0" }}/>:<div style={{ width:110,height:80,borderRadius:7,background:"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:34 }}>{CEMOJI[offer.category]||"📦"}</div>}
        <div style={{ flex:1 }}>
          <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:6 }}>{allCerts.map(c=><Badge key={c} color="#0d9488">{c}</Badge>)}{offer.origin&&<Badge>{FLAGS[offer.origin]||"🌐"} {CNAMES[offer.origin]||offer.origin}</Badge>}</div>
          <h3 style={{ margin:"0 0 8px",fontSize:15 }}>{offer.title||offer.product}</h3>
          <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>{[["Wolumen",offer.volume&&offer.volumeUnit?`${offer.volume} ${offer.volumeUnit}`:offer.volume],["Min.",offer.minOrder],["Sezon",offer.from&&offer.to?`${offer.from}–${offer.to}`:null]].map(([l,v])=>v&&<div key={l} style={{ textAlign:"center",padding:"6px 10px",background:"white",borderRadius:7,border:"1px solid #e2e8f0" }}><div style={{ fontSize:9,color:"#94a3b8",textTransform:"uppercase" }}>{l}</div><div style={{ fontWeight:700,fontSize:12 }}>{v}</div></div>)}</div>
        </div>
      </div>
      <p style={{ color:"#475569",lineHeight:1.7,marginBottom:12,fontSize:13,whiteSpace:"pre-line" }}>{renderDesc(offer.description)}</p>
      {allPack.length>0&&<div style={{ marginBottom:10 }}><strong style={{ fontSize:11,color:"#64748b" }}>OPAKOWANIE:</strong><div style={{ display:"flex",gap:4,marginTop:3,flexWrap:"wrap" }}>{allPack.map(p=><Badge key={p}>{p}</Badge>)}</div></div>}
      {co&&<div style={{ padding:12,background:"#f8fafc",borderRadius:8,display:"flex",gap:10,fontSize:12 }}>{co.logo?<img src={co.logo} alt="" style={{ width:38,height:38,objectFit:"cover",borderRadius:7 }}/>:<div style={{ width:38,height:38,borderRadius:7,background:"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center" }}><Building2 size={16} color="#94a3b8"/></div>}<div style={{ flex:1 }}><div style={{ fontWeight:700 }}>{co.name}</div><div style={{ color:"#64748b" }}>{FLAGS[co.country]||"🌐"} {co.city}</div></div>{ct&&<div><div><Phone size={11} style={{ verticalAlign:"middle" }}/> {ct.phone}</div><div><Mail size={11} style={{ verticalAlign:"middle" }}/> {ct.email}</div></div>}</div>}
    </Modal>
  );
}

const ROLE_COLORS = { admin:"#7c3aed", supplier:"#0d9488", buyer:"#2563eb" };
const ROLE_LABELS  = { admin:"Admin", supplier:"Dostawca", buyer:"Kupiec" };

function AccountSwitcherBar({ account, accounts, onSwitch, wallet, fmSettings, retailers }) {
  const [open, setOpen] = useState(false);
  const [filterRole, setFilterRole] = useState("all");
  const ph = FM_PHASES[fmSettings.currentPhase-1];

  const groups = {
    admin:    accounts.filter(a=>a.role==="admin"),
    supplier: accounts.filter(a=>a.role==="supplier"),
    buyer:    accounts.filter(a=>a.role==="buyer"),
  };
  const visible = filterRole==="all" ? accounts : accounts.filter(a=>a.role===filterRole);

  return (
    <div style={{ position:"sticky",top:0,zIndex:999,background:"#0f172a",borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ display:"flex",alignItems:"center",gap:10,padding:"6px 14px" }}>
        {/* Logo */}
        <span style={{ fontSize:16 }}>🍎</span>
        <span style={{ color:"white",fontWeight:700,fontSize:13 }}>Fresh Market</span>

        {/* Active account badge */}
        <div style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 12px",borderRadius:20,background:ROLE_COLORS[account.role]+"22",border:`1px solid ${ROLE_COLORS[account.role]}55`,cursor:"pointer" }} onClick={()=>setOpen(!open)}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:ROLE_COLORS[account.role] }}/>
          <span style={{ color:"white",fontSize:12,fontWeight:600 }}>{account.name}</span>
          <span style={{ fontSize:10,color:ROLE_COLORS[account.role],background:ROLE_COLORS[account.role]+"22",padding:"1px 6px",borderRadius:8,fontWeight:700 }}>{ROLE_LABELS[account.role]}{account.pkg?` · ${account.pkg}`:""}</span>
          <span style={{ color:"rgba(255,255,255,0.4)",fontSize:12 }}>{open?"▲":"▼"}</span>
        </div>

        {/* FM phase badge */}
        {fmSettings.schedulingOpen&&(
          <div style={{ padding:"3px 10px",borderRadius:16,background:ph?.color+"22",border:`1px solid ${ph?.color}55`,fontSize:10,color:ph?.color,fontWeight:700,display:"flex",gap:4,alignItems:"center" }}>
            <Calendar size={9}/>{ph?.label}
          </div>
        )}

        {/* Wallet badge (suppliers) */}
        {account.role==="supplier"&&wallet.balance>0&&(
          <div style={{ padding:"3px 10px",borderRadius:16,background:"rgba(5,150,105,0.18)",border:"1px solid rgba(5,150,105,0.35)",fontSize:11,color:"#6ee7b7",display:"flex",gap:4,alignItems:"center" }}>
            <Wallet size={10}/>{wallet.balance} EUR
          </div>
        )}

        {/* Role filter quick buttons */}
        <div style={{ marginLeft:"auto",display:"flex",gap:4 }}>
          {[["all","Wszyscy",(accounts.length)],["admin","Admin",groups.admin.length],["supplier","Dostawcy",groups.supplier.length],["buyer","Kupcy",groups.buyer.length]].map(([k,l,n])=>(
            <button key={k} onClick={()=>{setFilterRole(k);setOpen(true);}}
              style={{ padding:"3px 10px",borderRadius:12,border:`1px solid ${filterRole===k?ROLE_COLORS[k]||"#0d9488":"rgba(255,255,255,0.12)"}`,background:filterRole===k?(ROLE_COLORS[k]||"#0d9488"):"transparent",color:filterRole===k?"white":"rgba(255,255,255,0.5)",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit" }}>
              {l} <span style={{ opacity:0.6 }}>({n})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Dropdown */}
      {open&&(
        <div style={{ position:"absolute",left:0,right:0,top:"100%",background:"#0f172a",border:"1px solid rgba(255,255,255,0.1)",borderTop:"none",zIndex:1000,maxHeight:420,overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}>
          {/* Group headers */}
          {["admin","supplier","buyer"].map(roleKey=>{
            const grp = visible.filter(a=>a.role===roleKey);
            if(grp.length===0) return null;
            return(
              <div key={roleKey}>
                <div style={{ padding:"6px 16px",fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.25)",fontWeight:700,background:"rgba(255,255,255,0.03)",borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                  {ROLE_LABELS[roleKey]}s ({grp.length})
                </div>
                {grp.map(acc=>(
                  <button key={acc.id} onClick={()=>{onSwitch(acc);setOpen(false);setFilterRole("all");}}
                    style={{ width:"100%",padding:"9px 16px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:account.id===acc.id?"rgba(255,255,255,0.06)":"transparent",cursor:"pointer",textAlign:"left",border:"none",display:"flex",alignItems:"center",gap:10,transition:"background 0.1s",opacity:(acc.role==="buyer"&&(retailers||[]).find(x=>x.id===acc.retailerId)?.active===false)?0.5:1 }}>
                    <div style={{ width:8,height:8,borderRadius:"50%",background:ROLE_COLORS[acc.role],flexShrink:0 }}/>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ color:"white",fontSize:12,fontWeight:account.id===acc.id?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{acc.name}</div>
                      <div style={{ color:"rgba(255,255,255,0.35)",fontSize:10,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {acc.email} · {acc.title}
                        {acc.role==="buyer"&&retailers&&(()=>{const r=(retailers||[]).find(x=>x.id===acc.retailerId);return r&&r.active===false?<span style={{color:"#fca5a5",marginLeft:4,fontWeight:600}}>(sieć nieaktywna)</span>:null;})()}
                      </div>
                    </div>
                    {acc.pkg&&<span style={{ fontSize:9,padding:"2px 7px",borderRadius:8,background:acc.pkg==="Premium"?"rgba(251,191,36,0.2)":"rgba(59,130,246,0.2)",color:acc.pkg==="Premium"?"#fbbf24":"#60a5fa",fontWeight:700,flexShrink:0 }}>{acc.pkg}</span>}
                    {account.id===acc.id&&<span style={{ fontSize:10,color:"#0d9488",fontWeight:700,flexShrink:0 }}>✓ aktywne</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {open&&<div style={{ position:"fixed",inset:0,zIndex:999 }} onClick={()=>setOpen(false)}/>}
    </div>
  );
}

const FM_VENUE = "MCC Mazurkas Conference Centre, Ożarów Mazowiecki";
const FM_DATE  = "24 września 2026";

/* ── NumBadge — colored slot number badge (light theme) ── */
function NumBadge({ num, size="md" }) {
  if (!num || num <= 0) return <span style={{ color:"#94a3b8",fontFamily:"'JetBrains Mono',monospace" }}>—</span>;
  const zone = num <= 25 ? "green" : num <= 35 ? "orange" : "red";
  const zc = FM_NZS[zone];
  const fs = size==="lg" ? 22 : size==="sm" ? 11 : 14;
  const dim = size==="lg" ? 52 : size==="sm" ? 26 : 36;
  return (
    <div style={{ width:dim,height:dim,borderRadius:Math.round(dim*0.25),background:zc.bg,border:`2px solid ${zc.b}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
      {size!=="sm"&&<div style={{ fontSize:7,color:zc.c,opacity:0.7,letterSpacing:0.5,lineHeight:1 }}>NR</div>}
      <div style={{ fontSize:fs,fontWeight:900,color:zc.c,fontFamily:"'JetBrains Mono',monospace",lineHeight:1 }}>{num}</div>
    </div>
  );
}

/* ── ZoneLegend ── */
function ZoneLegend() {
  return (
    <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginTop:12 }}>
      {[["🟢","1–25","Dobra pozycja","#059669","#f0fdf4","#bbf7d0"],["🟠","26–35","Średnia pozycja","#d97706","#fffbeb","#fde68a"],["🔴","36+","Późna pozycja","#dc2626","#fee2e2","#fca5a5"]].map(([i,r,l,c,bg,b])=>(
      <span key={r} style={{ padding:"3px 12px",borderRadius:8,background:bg,border:`1px solid ${b}`,fontSize:11,fontWeight:600,color:c }}>{i} Numery {r} — {l}</span>
    ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN PREFERENCES VIEW (Faza 2 podgląd dla admina)
═══════════════════════════════════════════════════════════════ */
function FMAdminPreferencesView({ fmPrefs, fmResps, retailers, fmChains, fmSuppliers, companies }) {
  // [B2B Round supplier-FM-UX] Resolve a supplier list-row to its company row.
  const findCo = (s) => (companies || []).find(c =>
    c.fmId === s.id || c.legacy_fm_id === s.id ||
    c.legacy_supplier_id === s.id || c.legacy_supplier_id === ("sup-" + (s.id || ""))
  );
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const [subView, setSubView] = useState("suppliers"); // "suppliers" | "chains"
  const [selSup, setSelSup] = useState(_suppliers[0]?.id||"s1");
  const [selChain, setSelChain] = useState(_chains[0]?.id||"ch1");
  const [search, setSearch] = useState("");

  const filteredSup = _suppliers.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredChains = _chains.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));

  // Stats
  const totalStars   = _suppliers.reduce((a,s)=>a+_chains.filter(c=>fmPrefs[s.id]?.[c.id]==="star").length,0);
  const totalThumbs  = _suppliers.reduce((a,s)=>a+_chains.filter(c=>fmPrefs[s.id]?.[c.id]==="thumb").length,0);
  const totalWant    = _chains.reduce((a,c)=>a+_suppliers.filter(s=>fmResps[c.id]?.[s.id]==="want").length,0);
  const totalChance  = _chains.reduce((a,c)=>a+_suppliers.filter(s=>fmResps[c.id]?.[s.id]==="chance").length,0);
  const totalRemove  = _chains.reduce((a,c)=>a+_suppliers.filter(s=>fmResps[c.id]?.[s.id]==="remove").length,0);

  return (
    <div>
      {/* Global stats */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16 }}>
        {[[totalStars,"⭐ Główne wybory","#d97706"],[totalThumbs,"👍 Rezerwowe","#0d9488"],[totalWant,"✅ Chcę","#059669"],[totalChance,"🤝 Daj szansę","#d97706"],[totalRemove,"❌ Nie","#dc2626"]].map(([v,l,c])=>(
          <div key={l} style={{ padding:"10px 14px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center" }}>
            <div style={{ fontSize:20,fontWeight:800,color:c }}>{v}</div>
            <div style={{ fontSize:10,color:"#64748b",marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Sub-view switcher */}
      <div style={{ display:"flex",gap:0,marginBottom:14,background:"#f1f5f9",borderRadius:10,padding:4,width:"fit-content" }}>
        {[["suppliers","🏭 Preferencje dostawców"],["chains","🏪 Odpowiedzi sieci"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubView(k)} style={{ padding:"7px 16px",borderRadius:8,border:"none",background:subView===k?"white":"transparent",fontWeight:subView===k?600:400,fontSize:12,cursor:"pointer",fontFamily:"inherit",color:subView===k?"#1e293b":"#64748b",boxShadow:subView===k?"0 1px 3px rgba(0,0,0,0.08)":"none",whiteSpace:"nowrap" }}>{l}</button>
        ))}
      </div>

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={subView==="suppliers"?"Szukaj firmy...":"Szukaj sieci..."}
        style={{ width:"100%",padding:"8px 14px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",marginBottom:10,maxWidth:320 }}/>

      {/* ── DOSTAWCY ── */}
      {subView==="suppliers" && (
        <div style={{ display:"grid",gridTemplateColumns:"280px 1fr",gap:12 }}>
          {/* Supplier list */}
          <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden",maxHeight:520,overflowY:"auto" }}>
            {filteredSup.map(s=>{
              const prefs = fmPrefs[s.id]||{};
              const stars = Object.values(prefs).filter(v=>v==="star").length;
              const thumbs = Object.values(prefs).filter(v=>v==="thumb").length;
              const filled = stars>=5;
              const confirmedAt = findCo(s)?.fm_selection_confirmed_at;
              return(
                <div key={s.id} onClick={()=>setSelSup(s.id)}
                  style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:selSup===s.id?"#f0fdfa":"white" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ width:6,height:6,borderRadius:3,background:s.pkg==="Premium"?"#d97706":"#3b82f6",flexShrink:0 }}/>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:12,fontWeight:selSup===s.id?700:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{s.name}</div>
                      <div style={{ fontSize:10,color:"#94a3b8" }}>{s.country}{confirmedAt && <span style={{color:"#059669",marginLeft:6,fontWeight:700}}>✓ POTWIERDZONO</span>}</div>
                    </div>
                    <div style={{ fontSize:10,display:"flex",gap:4 }}>
                      <span style={{ color:"#d97706",fontWeight:700 }}>⭐{stars}</span>
                      <span style={{ color:"#0d9488",fontWeight:700 }}>👍{thumbs}</span>
                    </div>
                    {filled
                      ? <span style={{ width:7,height:7,borderRadius:"50%",background:"#059669",flexShrink:0 }}/>
                      : <span style={{ width:7,height:7,borderRadius:"50%",background:"#e2e8f0",flexShrink:0 }}/>
                    }
                  </div>
                </div>
              );
            })}
          </div>
          {/* Supplier detail */}
          {(()=>{
            const s = _suppliers.find(x=>x.id===selSup);
            if(!s) return null;
            const prefs = fmPrefs[s.id]||{};
            const stars = _chains.filter(c=>prefs[c.id]==="star");
            const thumbs = _chains.filter(c=>prefs[c.id]==="thumb");
            const confirmedAt = findCo(s)?.fm_selection_confirmed_at;
            return(
              <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,padding:18 }}>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:800,color:"#1e293b" }}>{s.name}</div>
                    <div style={{ fontSize:12,color:"#64748b" }}>{s.country} · {s.products}</div>
                  </div>
                  <Badge color={s.pkg==="Premium"?"#d97706":"#2563eb"} bg={s.pkg==="Premium"?"#fef3c7":"#eff6ff"}>{s.pkg}</Badge>
                  {confirmedAt && <Badge color="#059669" bg="#f0fdf4">✓ Potwierdzono {new Date(confirmedAt).toLocaleDateString("pl-PL")}</Badge>}
                </div>
                {stars.length>0&&<>
                  <div style={{ fontSize:11,fontWeight:700,color:"#1e293b",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em" }}>⭐ Główne sieci ({stars.length}/5)</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:14 }}>
                    {stars.map(c=>{
                      const resp = fmResps[c.id]?.[s.id];
                      const rc = resp==="want"?"#059669":resp==="chance"?"#d97706":resp==="remove"?"#dc2626":"#94a3b8";
                      // [B2B Round FM-buyer-rejection-logic] Semantic labels for
                      // admin clarity. "remove" maps to NIE CHCE SPOTKANIA per spec.
                      const rl = resp==="want"?"✅ CHCE":resp==="chance"?"🤝 NA KONIEC":resp==="remove"?"❌ NIE CHCE":"⏳ brak";
                      const rTitle = resp==="want"?"Kupiec: CHCE SPOTKANIE":resp==="chance"?"Kupiec: NA KONIEC KOLEJKI (deprioritized_by_buyer)":resp==="remove"?"Kupiec: NIE CHCE SPOTKANIA (rejected_by_buyer)":"Kupiec jeszcze nie odpowiedział";
                      return(
                        <div key={c.id} title={rTitle} style={{ padding:"8px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",display:"flex",alignItems:"center",gap:6 }}>
                          <span style={{ fontSize:11,fontWeight:700,color:"#1e293b",flex:1 }}>{c.name}</span>
                          <span style={{ fontSize:10,fontWeight:700,color:rc,whiteSpace:"nowrap" }}>{rl}</span>
                        </div>
                      );
                    })}
                  </div>
                </>}
                {thumbs.length>0&&<>
                  <div style={{ fontSize:11,fontWeight:700,color:"#1e293b",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em" }}>👍 Rezerwowe ({thumbs.length})</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:5 }}>
                    {thumbs.map(c=>{
                      const resp = fmResps[c.id]?.[s.id];
                      const rc = resp==="want"?"#059669":resp==="chance"?"#d97706":resp==="remove"?"#dc2626":"#94a3b8";
                      const rl = resp==="want"?"✅ CHCE":resp==="chance"?"🤝 NA KONIEC":resp==="remove"?"❌ NIE CHCE":"⏳ brak";
                      const rTitle = resp==="want"?"Kupiec: CHCE SPOTKANIE":resp==="chance"?"Kupiec: NA KONIEC KOLEJKI":resp==="remove"?"Kupiec: NIE CHCE SPOTKANIA":"Kupiec jeszcze nie odpowiedział";
                      return(
                        <div key={c.id} title={rTitle} style={{ padding:"7px 10px",borderRadius:8,background:"#f0fdfa",border:"1px solid #a7f3d0",display:"flex",alignItems:"center",gap:6 }}>
                          <span style={{ fontSize:11,color:"#1e293b",flex:1 }}>{c.name}</span>
                          <span style={{ fontSize:10,fontWeight:700,color:rc,whiteSpace:"nowrap" }}>{rl}</span>
                        </div>
                      );
                    })}
                  </div>
                </>}
                {stars.length===0&&thumbs.length===0&&<div style={{ padding:30,textAlign:"center",color:"#94a3b8" }}>Ta firma nie wybrała jeszcze sieci.</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── SIECI ── */}
      {subView==="chains" && (
        <div style={{ display:"grid",gridTemplateColumns:"280px 1fr",gap:12 }}>
          {/* Chain list */}
          <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden",maxHeight:520,overflowY:"auto" }}>
            {filteredChains.map(c=>{
              const resps = fmResps[c.id]||{};
              const nWant = Object.values(resps).filter(v=>v==="want").length;
              const nChance = Object.values(resps).filter(v=>v==="chance").length;
              const nInterested = _suppliers.filter(s=>fmPrefs[s.id]?.[c.id]).length;
              return(
                <div key={c.id} onClick={()=>setSelChain(c.id)}
                  style={{ padding:"10px 14px",borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:selChain===c.id?"#f0fdfa":"white" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:12,fontWeight:selChain===c.id?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.name}</div>
                      <div style={{ fontSize:10,color:"#94a3b8" }}>{c.country}</div>
                    </div>
                    <div style={{ fontSize:10,display:"flex",gap:4 }}>
                      <span style={{ color:"#94a3b8" }}>{nInterested}zgł.</span>
                      <span style={{ color:"#059669",fontWeight:700 }}>✅{nWant}</span>
                      <span style={{ color:"#d97706",fontWeight:700 }}>🤝{nChance}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Chain detail */}
          {(()=>{
            const ch = _chains.find(x=>x.id===selChain);
            if(!ch) return null;
            const resps = fmResps[ch.id]||{};
            const interested = _suppliers.filter(s=>fmPrefs[s.id]?.[ch.id]);
            const groups = {want:[],chance:[],remove:[]};
            interested.forEach(s=>{
              const r=resps[s.id]||"none";
              if(groups[r]) groups[r].push(s); else groups.remove.push(s);
            });
            return(
              <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:12,padding:18,maxHeight:520,overflowY:"auto" }}>
                <div style={{ fontSize:16,fontWeight:800,marginBottom:4 }}>{ch.name}</div>
                <div style={{ fontSize:12,color:"#64748b",marginBottom:14 }}>{ch.country} · {ch.cat} · {interested.length} zgłoszeń</div>
                {[["want","✅ Chcę","#059669","#f0fdf4","#bbf7d0"],["chance","🤝 Daj szansę","#d97706","#fffbeb","#fde68a"],["remove","❌ Nie / brak","#dc2626","#fef2f2","#fca5a5"]].map(([key,lbl,c,bg,b])=>(
                  groups[key].length>0&&(
                    <div key={key} style={{ marginBottom:12 }}>
                      <div style={{ fontSize:11,fontWeight:700,color:c,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em" }}>{lbl} ({groups[key].length})</div>
                      {groups[key].map(s=>(
                        <div key={s.id} style={{ padding:"7px 10px",borderRadius:8,background:bg,border:`1px solid ${b}`,marginBottom:4,display:"flex",gap:8,alignItems:"center" }}>
                          <span style={{ fontSize:11,fontWeight:600,flex:1 }}>{s.name}</span>
                          <span style={{ fontSize:10,color:"#64748b" }}>{s.country}</span>
                          <Badge color={s.pkg==="Premium"?"#d97706":"#2563eb"} bg={s.pkg==="Premium"?"#fef3c7":"#eff6ff"}>{s.pkg}</Badge>
                          <span style={{ fontSize:10,color:"#94a3b8" }}>{fmPrefs[s.id]?.[ch.id]==="star"?"⭐":"👍"}</span>
                        </div>
                      ))}
                    </div>
                  )
                ))}
                {interested.length===0&&<div style={{ padding:24,textAlign:"center",color:"#94a3b8" }}>Brak zgłoszeń dla tej sieci.</div>}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function FMPhaseBanner({ phase, extra }) {
  const ph = FM_PHASES[phase-1];
  return (
    <div style={{ padding:"10px 14px",borderRadius:9,border:`1px solid ${ph.color}44`,background:ph.color+"0a",marginBottom:16,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
      <div style={{ width:8,height:8,borderRadius:"50%",background:ph.color,flexShrink:0 }}/>
      <span style={{ fontSize:12,fontWeight:600,color:ph.color }}>{ph.label} — {ph.sub}</span>
      <span style={{ fontSize:11,color:"#64748b" }}>· {ph.dates}</span>
      {extra && <span style={{ fontSize:11,color:"#64748b",marginLeft:"auto" }}>{extra}</span>}
    </div>
  );
}

function FMVenueFooter({ extra }) {
  return (
    <div style={{ marginTop:20,padding:"16px 20px",background:"#0f172a",borderRadius:10,color:"rgba(255,255,255,0.65)",fontSize:12,lineHeight:1.9 }}>
      <div style={{ color:"white",fontWeight:700,fontSize:14,marginBottom:4 }}>Fresh Market 2026</div>
      {FM_DATE}<br/>
      {FM_VENUE}
      {extra && <><br/>{extra}</>}
    </div>
  );
}

function FMLockScreen({ openDate, message }) {
  // When a custom message is passed, show a simpler "processing" lock screen
  if (message) return (
    <div style={{ maxWidth:680 }}>
      <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:16,padding:"48px 40px",textAlign:"center" }}>
        <div style={{ width:68,height:68,borderRadius:"50%",background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
          <span style={{ fontSize:32 }}>⚙️</span>
        </div>
        <div style={{ fontSize:20,fontWeight:700,color:"#1e293b",marginBottom:10 }}>Trwa generowanie planu spotkań</div>
        <div style={{ fontSize:14,color:"#64748b",lineHeight:1.75,maxWidth:480,margin:"0 auto 24px" }}>
          {message}
        </div>
        <div style={{ fontSize:11,color:"#94a3b8" }}>
          Pytania? Kontakt: <strong>Oksana Kozłowska</strong> · oksana@freshmarket.eu · +48 603 811 818
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ maxWidth:680 }}>
      <div style={{ background:"white",border:"1px solid #e2e8f0",borderRadius:16,padding:"48px 40px",textAlign:"center" }}>
        <div style={{ width:68,height:68,borderRadius:"50%",background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
          <Lock size={30} color="#64748b"/>
        </div>
        <div style={{ fontSize:20,fontWeight:700,color:"#1e293b",marginBottom:10 }}>Spotkania B2B — Fresh Market 2026</div>
        <div style={{ fontSize:14,color:"#64748b",marginBottom:28,lineHeight:1.7,maxWidth:480,margin:"0 auto 28px" }}>
          Planowanie spotkań B2B z kupcami sieci handlowych na targach <strong>Fresh Market 2026</strong>.<br/>Wybory partnerów: <strong>do 16 września</strong>. Publikacja planu: <strong>22 września</strong>. Event: <strong>24 września</strong>.
        </div>
        <div style={{ display:"inline-flex",alignItems:"center",gap:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:"14px 24px",marginBottom:28 }}>
          <Calendar size={20} color="#d97706"/>
          <div style={{ textAlign:"left" }}>
            <div style={{ fontSize:13,fontWeight:700,color:"#92400e" }}>Planowane otwarcie: {openDate||"1 września 2026"}</div>
            <div style={{ fontSize:11,color:"#64748b",marginTop:1 }}>Wybory do 16 września · Publikacja 22 września · Event 24 września</div>
          </div>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,maxWidth:480,margin:"0 auto 28px" }}>
          {[["⭐","Wybierz sieci","Zaznacz preferowane sieci i rezerwy"],["🤖","Algorytm","Inteligentne przypisanie spotkań"],["📋","Plan spotkań","Twoje numery spotkań na dzień eventu"]].map(f=>(
            <div key={f[0]} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 10px",textAlign:"center" }}>
              <div style={{ fontSize:22,marginBottom:6 }}>{f[0]}</div>
              <div style={{ fontSize:11,fontWeight:700,color:"#334155",marginBottom:2 }}>{f[1]}</div>
              <div style={{ fontSize:10,color:"#94a3b8" }}>{f[2]}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:11,color:"#94a3b8" }}>
          Pytania? Kontakt: <strong>Oksana Kozłowska</strong> · oksana@freshmarket.eu · +48 603 811 818
        </div>
      </div>
    </div>
  );
}

/* ── RetailerPreviewModal — shows chain info for supplier (no buyer personal data) ── */
function RetailerPreviewModal({ retailer, onClose }) {
  if (!retailer) return null;
  const initials = retailer.name ? retailer.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "??";
  const cats = (retailer.buyers||[]).flatMap(b=>b.cats||[]).filter((v,i,a)=>a.indexOf(v)===i);
  return (
    <Modal title="Podgląd sieci handlowej" onClose={onClose}>
      <div style={{ display:"flex",gap:14,alignItems:"center",marginBottom:16,padding:"14px 16px",background:"#f8fafc",borderRadius:10 }}>
        <div style={{ width:52,height:52,borderRadius:12,background:"linear-gradient(135deg,#0d9488,#0891b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:18,flexShrink:0 }}>{initials}</div>
        <div>
          <div style={{ fontWeight:700,fontSize:16,color:"#1e293b" }}>{retailer.name}</div>
          <div style={{ fontSize:12,color:"#64748b",marginTop:2 }}>{FLAGS[retailer.country]||"🌐"} {CNAMES[retailer.country]||retailer.country}</div>
        </div>
      </div>
      {cats.length > 0 && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",color:"#64748b",letterSpacing:"0.06em",marginBottom:6 }}>Kategorie</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {cats.map(cat=><span key={cat} style={{ padding:"4px 12px",borderRadius:20,background:"rgba(13,148,136,0.08)",color:"#0d9488",fontSize:12,fontWeight:600 }}>{CEMOJI[cat]||"📦"} {cat}</span>)}
          </div>
        </div>
      )}
      <div style={{ fontSize:11,color:"#94a3b8",marginTop:8,padding:"8px 12px",background:"#f8fafc",borderRadius:7 }}>
        Dane kontaktowe kupca są niedostępne w tym widoku.
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FM PAGE — SUPPLIER
═══════════════════════════════════════════════════════════════ */
function PageSupplierFM({ fmId, fmSettings, fmPrefs, setFmPrefs, fmResps, fmAlgo, fmSchedule, setFmSchedule, subPage, fmChains, fmSuppliers, companies, offers, previewFor, retailers, accountId, confirmFmSelection }) {
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const sid = fmId || "s1";
  const phase = fmSettings.currentPhase;
  const pub   = fmSettings.planPublished;
  const [previewFirm, setPreviewFirm] = useState(null);
  const [previewRetailer, setPreviewRetailer] = useState(null);

  if (!fmSettings.schedulingOpen && (fmSettings.currentPhase||1) < 2) return <FMLockScreen openDate={fmSettings.openDate}/>;

  const myPrefs  = fmPrefs[sid] || {};
  const currentPlan = pickFMPlan(fmSchedule, fmAlgo); // approved schedule wins; fall back to algo if schedule malformed
  // Count only from _chains that are displayed (avoids seed keys for non-displayed chains)
  const stars    = _chains.filter(c => myPrefs[c.id] === "star").length;
  const thumbs   = _chains.filter(c => myPrefs[c.id] === "thumb").length;
  const meetings = currentPlan?.res?.[sid]?.m || [];

  function toggle(cid) {
    if (phase !== 2) return; // only editable in phase 2
    const cur = myPrefs[cid];
    const np = { ...fmPrefs, [sid]: { ...myPrefs } };
    if (!cur) { if (stars < 5) np[sid][cid] = "star"; else np[sid][cid] = "thumb"; }
    else if (cur === "star") { np[sid][cid] = "thumb"; }
    else { delete np[sid][cid]; }
    setFmPrefs(np);
    const company = (companies || []).find(c => c.fmId === sid || c.legacy_fm_id === sid || c.id === sid);
    if (company?.id) {
      const rows = buildTargetRetailerRowsFromPrefs(np[sid], retailers);
      dbSetCompanyTargetRetailers(company.id, rows).catch(e => console.warn("[save target retailers]", e));
    }
  }



  // Determine what to show based on subPage + phase
  const activeSubPage = subPage || "fm-sched";

  // ══ WYBÓR SIECI (phase 2: preferencje, read-only after) ══════════════════
  if (activeSubPage === "fm-sched") {
    const readOnly = phase !== 2;
    const ready = stars >= 5;
    return (
      <div style={{ maxWidth:900 }}>
        {previewFirm && <CompanyPreviewModal co={previewFirm} offers={offers} onClose={()=>setPreviewFirm(null)}/>}
        <FMPhaseBanner phase={Math.min(phase,2)}/>
        <div style={{ padding:"14px 18px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,marginBottom:16,fontSize:13,color:"#1e40af",lineHeight:1.75 }}>
          {readOnly
            ? <><strong>Wybory zamknięte — 16 września.</strong> Twoje preferencje zostały zapisane. Administrator układa teraz plan spotkań. Finalne numerki zostaną opublikowane <strong>22 września</strong>. W sprawie zmian napisz do administratora przez Chat.</>
            : <><strong>Etap: do 16 września 2026</strong><br/>Wybierz sieci handlowe, z którymi chcesz się spotkać. Możesz zmieniać wybory do zamknięcia. Po tym terminie wybory są nieodwracalne — jeśli będziesz chcieć coś zmienić, napisz do administratora przez Chat.</>
          }
        </div>
        {!readOnly&&(
          <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap" }}>
            {[[`${stars}/5`,"⭐ Główne sieci",stars>=5?"#059669":"#d97706"],[`${thumbs}`,"👍 Rezerwowe","#64748b"],[ready?"Gotowe ✓":"⏳ Wybierz 5 sieci","Status",ready?"#059669":"#dc2626"]].map(([v,l,c])=>(
              <div key={l} style={{ flex:1,minWidth:100,padding:"12px 14px",background:"white",border:`1.5px solid ${c+"33"}`,borderRadius:10,textAlign:"center" }}>
                <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
                <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        )}
        {!readOnly&&ready&&<Alrt type="success">Gotowe! 5 głównych sieci wybranych. Możesz jeszcze dodać rezerwowe. Wybory można zmieniać do <strong>16 września 2026</strong> (godz. 23:59).</Alrt>}
        {(() => {
          // [B2B Round supplier-FM-UX] Confirmation block. Shown only in editable
          // phase (readOnly=false). Resolves the supplier's company row from
          // companies[] and reads fm_selection_confirmed_at — present means
          // "Wybór potwierdzony"; absent means user hasn't clicked Potwierdź yet.
          if (readOnly) return null;
          const co = (companies || []).find(c =>
            c.id === accountId
            || (fmId && (c.fmId === fmId || c.legacy_fm_id === fmId))
          );
          const confirmedAt = co?.fm_selection_confirmed_at || null;
          return (
            <div style={{ background:"white",border:`2px solid ${confirmedAt?"#059669":ready?"#0d9488":"#e2e8f0"}`,borderRadius:12,padding:"16px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
              <div style={{ flex:1,minWidth:200 }}>
                {confirmedAt ? (
                  <>
                    <div style={{ fontWeight:700,fontSize:13,color:"#059669",display:"flex",alignItems:"center",gap:6 }}>
                      <CheckCircle size={15}/> Wybór potwierdzony
                    </div>
                    <div style={{ fontSize:11,color:"#64748b",marginTop:3 }}>
                      Zapisano: <strong>{new Date(confirmedAt).toLocaleString("pl-PL")}</strong>. Możesz jeszcze zmieniać wybory do 16 września — kliknij ponownie <em>Potwierdź wybór</em> po zmianach, żeby admin widział aktualną decyzję.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight:700,fontSize:13,color:ready?"#0d9488":"#64748b" }}>
                      {ready ? "Gotowe — kliknij Potwierdź wybór" : "Wybierz najpierw 5 głównych sieci"}
                    </div>
                    <div style={{ fontSize:11,color:"#64748b",marginTop:3 }}>
                      Twoje zaznaczenia są zapisywane na bieżąco, ale dopiero kliknięcie <em>Potwierdź wybór</em> oznacza dla administratora, że Twój wybór jest finalny.
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => { if (typeof confirmFmSelection === "function") confirmFmSelection(); }}
                disabled={!ready || typeof confirmFmSelection !== "function"}
                style={{
                  padding:"11px 22px",
                  background: !ready ? "#e2e8f0" : confirmedAt ? "#0d9488" : "#059669",
                  color: !ready ? "#94a3b8" : "white",
                  border:"none",
                  borderRadius:9,
                  fontWeight:700,
                  fontSize:13,
                  cursor: ready ? "pointer" : "not-allowed",
                  fontFamily:"inherit",
                  display:"flex",
                  alignItems:"center",
                  gap:7,
                  whiteSpace:"nowrap"
                }}
              >
                <CheckCircle size={14}/> {confirmedAt ? "Potwierdź ponownie" : "Potwierdź wybór"}
              </button>
            </div>
          );
        })()}
        <Card title={readOnly?"Twoje wybory sieci (tylko odczyt)":"Wybierz sieci handlowe"} icon={Store}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6 }}>
            {_chains.map(c => {
              const p = myPrefs[c.id];
              return (
                <div key={c.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:8,border:p==="star"?`2px solid #d97706`:p==="thumb"?`2px solid #0d9488`:`1px solid #e2e8f0`,background:p==="star"?"#fffbeb":p==="thumb"?"#f0fdfa":"white",opacity:readOnly&&!p?0.5:1 }}>
                  <button onClick={()=>toggle(c.id)} disabled={readOnly} style={{ background:"none",border:"none",cursor:readOnly?"default":"pointer",fontSize:18,minWidth:24,padding:0,lineHeight:1 }}>
                    {p==="star"?"⭐":p==="thumb"?"👍":"○"}
                  </button>
                  <RetailerLogo retailer={c} size={34}/>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:p?"700":"600",color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.name}</div>
                    <div style={{ fontSize:10,color:"#64748b" }}>{FLAGS[c.country]||"🌐"} {CNAMES[c.country]||c.country}</div>
                    <div style={{ fontSize:10,color:"#94a3b8",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.cat}</div>
                  </div>
                  {p==="star"&&<span style={{ fontSize:9,color:"#d97706",fontWeight:700,flexShrink:0 }}>GŁÓWNA</span>}
                  {p==="thumb"&&<span style={{ fontSize:9,color:"#0d9488",fontWeight:700,flexShrink:0 }}>REZERWOWA</span>}
                </div>
              );
            })}
          </div>
          {!readOnly&&<div style={{ marginTop:10,fontSize:11,color:"#94a3b8" }}>Kliknij raz → ⭐ główna (max 5) · kliknij ponownie → 👍 rezerwowa · kliknij jeszcze raz → usuń</div>}
        </Card>
      </div>
    );
  }

  // ══ ALGORYTM (phase 3: admin preview available if enabled) ════════════════
  if (activeSubPage === "fm-algo") {
    const hasPreview = previewFor?.suppliers?.includes(sid);
    if (!hasPreview) return (
      <FMLockScreen
        message="Wybory zostały zamknięte 16 września. Plan spotkań jest przygotowywany i korygowany przez administratora. Finalne numery zostaną opublikowane 22 września. Jeśli chcesz coś zgłosić, napisz do administratora przez Chat."
      />
    );
    return (
      <div style={{ maxWidth:700 }}>
        <div style={{ padding:"12px 16px",background:"#fef3c7",border:"2px solid #f59e0b",borderRadius:10,marginBottom:16,display:"flex",gap:10,alignItems:"flex-start" }}>
          <span style={{ fontSize:18,flexShrink:0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight:700,fontSize:13,color:"#92400e" }}>Podgląd roboczy — plan może jeszcze ulec zmianie</div>
            <div style={{ fontSize:12,color:"#92400e",marginTop:2 }}>Administrator udostępnił Ci wstępny podgląd planowanych spotkań. <strong>Nie jest to jeszcze finalny plan.</strong> Oficjalna publikacja nastąpi <strong>22 września 2026</strong>.</div>
          </div>
        </div>
        <FMPhaseBanner phase={3}/>
        <Card title="Wstępny podgląd planowanych spotkań" icon={Eye}>
          <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>Algorytm zaplanował spotkania z poniższymi sieciami. Plan roboczy — może ulec zmianie przed publikacją 22 września.</div>
          {meetings.length === 0
            ? <div style={{ padding:30,textAlign:"center",color:"#94a3b8" }}>Brak przypisanych spotkań w planie roboczym.</div>
            : meetings.map(cid => {
                const ch = _chains.find(x=>x.id===cid);
                const slotNum = currentPlan?.nums?.[sid]?.[cid] ?? null;
                const zoneKey = fmNZ(slotNum);
                const zc = zoneKey ? FM_NZS[zoneKey] : null;
                return (
                  <div key={cid} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 8px",borderBottom:"1px solid #f1f5f9",background:zc?zc.bg+"44":"transparent" }}>
                    <div style={{ width:34,height:34,borderRadius:"50%",background:zc?zc.c+"20":"#f1f5f9",border:`1.5px solid ${zc?zc.c:"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      {slotNum ? <span style={{ fontWeight:800,fontSize:13,color:zc?.c }}>{slotNum}</span> : <span style={{ fontSize:12 }}>?</span>}
                    </div>
                    <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:13 }}>{ch?.name||cid}</div><div style={{ fontSize:11,color:"#64748b" }}>{ch?.country} · {ch?.cat}</div></div>
                    {zc&&<span style={{ fontSize:11,fontWeight:600,color:zc.c }}>{zoneKey==="green"?"🟢 Dobra":zoneKey==="orange"?"🟠 Średnia":"🔴 Późna"}</span>}
                  </div>
                );
              })
          }
        </Card>
      </div>
    );
  }

  // ══ KOREKTY (phase 4: editable 17-18 sept, then read-only) ═══════════════
  // fm-korekty subpage removed from supplier UI — corrections via admin chat only

  if (activeSubPage === "fm-wyniki") {
    if (!pub) return (
      <div style={{ maxWidth:700 }}>
        <div style={{ padding:40,textAlign:"center",background:"white",borderRadius:14,border:"1px solid #e2e8f0" }}>
          <div style={{ fontSize:40,marginBottom:12 }}>⏳</div>
          <div style={{ fontSize:16,fontWeight:700,color:"#334155",marginBottom:8 }}>Plan w trakcie finalizacji</div>
          <div style={{ fontSize:13,color:"#64748b",lineHeight:1.7 }}>
            Administrator przygotowuje finalny plan spotkań.<br/>
            Zostanie opublikowany <strong>22 września 2026</strong>. Tego dnia zobaczysz swoje numery spotkań.<br/><br/>
            Pytania? Kontakt: <strong>Oksana Kozłowska</strong><br/>oksana@freshmarket.eu · +48 603 811 818
          </div>
        </div>
      </div>
    );

    // Published plan — use fmSchedule if available, else fmAlgo
    const planData = pickFMPlan(fmSchedule, fmAlgo);
    const myNums = planData?.nums?.[sid] || {};
    const entries = Object.entries(myNums).filter(([,n])=>n>0).sort((a,b)=>Number(a[1])-Number(b[1]));
    const myMeetings = planData?.res?.[sid]?.m || [];
    const rows = entries.length>0 ? entries : myMeetings.map((cid,i)=>[cid,i+1]);
    rows.sort((a,b)=>Number(a[1])-Number(b[1])); // numeric sort ascending

    return (
      <div style={{ maxWidth:700 }}>
        <FMPhaseBanner phase={5}/>
        <div style={{ background:"linear-gradient(135deg,#064e3b,#0f172a)",borderRadius:14,padding:"28px 24px",marginBottom:16,textAlign:"center" }}>
          <div style={{ fontSize:40,marginBottom:10 }}>🎪</div>
          <div style={{ fontSize:22,fontWeight:800,color:"white",marginBottom:4 }}>Fresh Market 2026</div>
          <div style={{ fontSize:13,color:"rgba(255,255,255,0.55)" }}>{FM_DATE} · {FM_VENUE}</div>
          <div style={{ marginTop:12 }}><Badge color="#6ee7b7" bg="rgba(5,150,105,0.2)">● Plan finalny opublikowany</Badge></div>
        </div>
        <Card title="Twój harmonogram spotkań — finalny" icon={Calendar}>
          {rows.length===0
            ? <div style={{ padding:30,textAlign:"center",color:"#94a3b8" }}>Brak zaplanowanych spotkań.</div>
            : rows.map(([cid,num])=>{
                const c = _chains.find(x=>x.id===cid);
                const zone = num<=25?"green":num<=35?"orange":"red";
                const zc = FM_NZS[zone];
                return (
                  <div key={cid} style={{ display:"flex",alignItems:"center",gap:14,padding:"12px 8px",marginBottom:5,borderRadius:10,background:zc.bg,border:`1px solid ${zc.b}` }}>
                    <NumBadge num={num} size="lg"/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14,fontWeight:700,color:"#1e293b" }}>{c?.name}</div>
                      <div style={{ fontSize:11,color:"#64748b" }}>{c?.country} · Spotkanie nr {num}</div>
                    </div>
                    <Btn sm outline onClick={()=>{const r=(retailers||[]).find(x=>x.fm26ChainId===cid||(x.fm26Active&&x.id===cid));setPreviewRetailer(r||{name:c?.name||cid,country:c?.country,buyers:[]});}} style={{fontSize:10}}><Eye size={10}/> Podgląd</Btn>
                    <Badge color="#059669" bg="#f0fdf4">✓</Badge>
                  </div>
                );
              })
          }
        </Card>
        {previewRetailer && <RetailerPreviewModal retailer={previewRetailer} onClose={()=>setPreviewRetailer(null)}/>}
        <FMVenueFooter/>
      </div>
    );
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════
   FM PAGE — BUYER
═══════════════════════════════════════════════════════════════ */
function PageBuyerFM({ chainId, fmSettings, fmPrefs, fmResps, setFmResps, fmAlgo, fmSchedule, fmChains, fmSuppliers, companies, offers, sends, fmWishlists, setFmWishlists, fmLateResps, setFmLateResps, previewFor, retailers }) {
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const phase = fmSettings.currentPhase;
  const pub   = fmSettings.planPublished;
  const [previewFirm, setPreviewFirm] = useState(null);
  const wishList = (fmWishlists || {})[chainId] || []; // global persistent wishlist per chain
  const [removeDialog, setRemoveDialog] = useState(null); // sid of supplier being considered for removal
  const [removeConfirm, setRemoveConfirm] = useState(null); // sid awaiting hard confirm

  if (!fmSettings.schedulingOpen && (fmSettings.currentPhase||1) < 2) return <FMLockScreen openDate={fmSettings.openDate}/>;

  const myResps    = fmResps[chainId] || {};
  const chain      = _chains.find(c=>c.id===chainId);
  const allParticipants = _suppliers; // full FM participant list (used for late-resps section)
  // [B2B Round 4] Primary list = suppliers who picked THIS chain in their preferences.
  // Only those count for matching (see buildFMData R1/R2 — supplierPref must be defined).
  // Sort: ⭐ main first, then 👍 reserve, then by name.
  const interestedSuppliers = _suppliers
    .filter(s => fmPrefs[s.id]?.[chainId])
    .sort((a, b) => {
      const pa = fmPrefs[a.id]?.[chainId];
      const pb = fmPrefs[b.id]?.[chainId];
      if (pa !== pb) return pa === "star" ? -1 : 1;
      return (a.name||"").localeCompare(b.name||"");
    });
  const currentPlan = pickFMPlan(fmSchedule, fmAlgo); // approved schedule wins; fall back to algo if schedule malformed
  const myMatches  = _suppliers.filter(s => currentPlan?.res?.[s.id]?.m?.includes(chainId));
  const ph = FM_PHASES[phase-1];

  function setResp(sid, val) {
    setFmResps(r => ({ ...r, [chainId]: { ...(r[chainId]||{}), [sid]: val } }));
    const retailer_id = resolveRetailerIdFromChain(chainId, retailers);
    const supplier = _suppliers.find(s => s.id === sid);
    const company = (companies || []).find(c => c.id === supplier?.companyId || c.fmId === sid || c.legacy_fm_id === sid);
    if (retailer_id && company?.id) {
      dbSaveFmResp({
        retailer_id,
        supplier_company_id: company.id,
        zone: val,
        status: val,
        meta: { supplier_legacy_id: sid, chain_id: chainId }
      }).catch(e => console.warn("[save buyer fm resp]", e));
    }
  }
  function toggleWish(sid) {
    if (!setFmWishlists) return;
    const retailer_id = resolveRetailerIdFromChain(chainId, retailers);
    if (!retailer_id) return;
    const exists = wishList.includes(sid);
    setFmWishlists(prev => {
      const cur = prev[chainId] || [];
      const updated = exists ? cur.filter(x=>x!==sid) : [...cur, sid];
      return { ...prev, [chainId]: updated };
    });
    const op = exists
      ? dbDeleteFmWishlist({ retailer_id, supplier_legacy_id: sid })
      : dbSaveFmWishlist({ retailer_id, supplier_legacy_id: sid, data: { chain_id: chainId } });
    op.catch(e => {
      console.warn("[save buyer fm wishlist]", e);
      setFmWishlists(prev => {
        const cur = prev[chainId] || [];
        const rolledBack = exists ? [...cur, sid] : cur.filter(x => x !== sid);
        return { ...prev, [chainId]: rolledBack };
      });
    });
  }
  function setLateResp(sid, nextVal) {
    if (!setFmLateResps) return;
    const retailer_id = resolveRetailerIdFromChain(chainId, retailers);
    if (!retailer_id) return;
    const currentVal = (fmLateResps?.[chainId] || {})[sid];
    const finalVal = currentVal === nextVal ? null : nextVal;
    setFmLateResps(prev => {
      const nextChain = { ...((prev && prev[chainId]) || {}) };
      if (finalVal) nextChain[sid] = finalVal;
      else delete nextChain[sid];
      return { ...(prev || {}), [chainId]: nextChain };
    });
    const op = finalVal
      ? dbSaveFmLateResp({ retailer_id, supplier_legacy_id: sid, zone: finalVal, data: { chain_id: chainId } })
      : dbDeleteFmLateResp({ retailer_id, supplier_legacy_id: sid });
    op.catch(e => {
      console.warn("[save buyer fm late resp]", e);
      setFmLateResps(prev => {
        const nextChain = { ...((prev && prev[chainId]) || {}) };
        if (currentVal) nextChain[sid] = currentVal;
        else delete nextChain[sid];
        return { ...(prev || {}), [chainId]: nextChain };
      });
    });
  }

  function openFirmPreview(s) {
    const realCo = companies ? companies.find(c => c.fmId === s.id || c.id === "sup-"+s.id) : null;
    setPreviewFirm(realCo || { name:s.name, country:s.country, description:`${s.name} — ${s.products}`, types:["producent"], contacts:[], certs:[] });
  }

  const phBanner = (
    <div style={{ padding:"10px 14px",borderRadius:9,border:`1px solid ${ph.color}44`,background:ph.color+"0a",marginBottom:16,display:"flex",alignItems:"center",gap:8 }}>
      <div style={{ width:8,height:8,borderRadius:"50%",background:ph.color,flexShrink:0 }}/>
      <span style={{ fontSize:12,fontWeight:600,color:ph.color }}>{ph.label} — {ph.sub}</span>
      <span style={{ fontSize:11,color:"#64748b" }}>· Panel kupca: <strong>{chain?.name}</strong></span>
    </div>
  );

  // FAZA 1-2: wybór preferencji przez kupca
  if (phase <= 2) return (
    <div style={{ maxWidth:900 }}>
      {previewFirm&&<CompanyPreviewModal co={previewFirm} offers={offers} sends={sends} role="buyer" buyerRetailerId={CHAIN_TO_RETAILER[chainId]||null} onClose={()=>setPreviewFirm(null)}/>}

      {/* Friction rejection dialog */}
      {removeDialog && (() => {
        const sup = _suppliers.find(x=>x.id===removeDialog);
        return (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center" }}>
            <div style={{ background:"white",borderRadius:14,padding:24,maxWidth:420,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
              {removeConfirm !== removeDialog ? (
                <>
                  <div style={{ fontWeight:700,fontSize:15,marginBottom:8 }}>Rezygnujesz ze spotkania z <span style={{color:"#0d9488"}}>{sup?.name}</span>?</div>
                  <div style={{ fontSize:13,color:"#64748b",marginBottom:20,lineHeight:1.6 }}>
                    Możemy przenieść tę firmę na koniec kolejki — jeśli będzie czas, spotkanie się odbędzie.
                  </div>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    <button onClick={()=>{ setResp(removeDialog,"chance"); setRemoveDialog(null); setRemoveConfirm(null); }}
                      style={{ padding:"11px 16px",borderRadius:9,border:"2px solid #d97706",background:"#fffbeb",color:"#92400e",fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"left" }}>
                      🔁 Przenieś na koniec kolejki <span style={{fontWeight:400,fontSize:12}}>(zalecane)</span>
                    </button>
                    <button onClick={()=>setRemoveConfirm(removeDialog)}
                      style={{ padding:"11px 16px",borderRadius:9,border:"1px solid #fca5a5",background:"white",color:"#dc2626",fontWeight:600,fontSize:12,cursor:"pointer",textAlign:"left" }}>
                      Nie chcę spotkania z tą firmą
                    </button>
                    <button onClick={()=>{ setRemoveDialog(null); setRemoveConfirm(null); }}
                      style={{ padding:"8px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:12,cursor:"pointer" }}>
                      Anuluj
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight:700,fontSize:15,marginBottom:8,color:"#dc2626" }}>⚠️ Potwierdzenie odrzucenia</div>
                  <div style={{ fontSize:13,color:"#334155",marginBottom:20,lineHeight:1.6 }}>
                    Oznaczysz firmę <strong>{sup?.name}</strong> jako <strong>NIE CHCĘ SPOTKANIA</strong>. Algorytm nie doda tej pary do Twojego planu. Administrator może wciąż dodać spotkanie ręcznie po wyraźnym ostrzeżeniu.
                  </div>
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={()=>{ setResp(removeDialog,"remove"); setRemoveDialog(null); setRemoveConfirm(null); }}
                      style={{ flex:1,padding:"11px 16px",borderRadius:9,border:"none",background:"#dc2626",color:"white",fontWeight:700,fontSize:13,cursor:"pointer" }}>
                      Tak, nie chcę spotkania
                    </button>
                    <button onClick={()=>{ setRemoveDialog(null); setRemoveConfirm(null); }}
                      style={{ padding:"11px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:12,cursor:"pointer" }}>
                      Anuluj
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {phBanner}
      <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap" }}>
        {[[interestedSuppliers.length,"Wybrali Twoją sieć","#0d9488"],[Object.values(myResps).filter(v=>v==="want").length,"✅ Chcę się spotkać","#059669"],[Object.values(myResps).filter(v=>v==="chance").length,"🤝 Daj szansę","#d97706"]].map(([v,l,c])=>(
          <div key={l} style={{ flex:1,minWidth:90,padding:"14px 16px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center" }}>
            <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
            <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>
      <Card title={`Dostawcy, którzy wybrali Twoją sieć`} icon={Users}>
        <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>Tylko firmy, które zaznaczyły Twoją sieć w "Wybór sieci". Algorytm dopasowuje wyłącznie pary, w których obie strony chcą spotkania.</div>
        {interestedSuppliers.length===0
          ? <div style={{ padding:30,textAlign:"center",color:"#94a3b8",fontSize:13,lineHeight:1.6 }}>Brak dostawców oczekujących na decyzję.<br/><span style={{fontSize:11}}>Gdy dostawcy zaznaczą Twoją sieć w "Wybór sieci", pojawią się tutaj.</span></div>
          : interestedSuppliers.map(s=>{
              const resp = myResps[s.id];
              const supPref = fmPrefs[s.id]?.[chainId];
              const prefLbl = supPref==="star" ? "⭐ Główna" : "👍 Rezerwowa";
              const prefCol = supPref==="star" ? "#d97706" : "#0d9488";
              return (
                <div key={s.id} style={{ padding:"12px 6px",borderBottom:"1px solid #f1f5f9",background:resp==="want"?"rgba(240,253,244,0.7)":resp==="chance"?"rgba(255,251,235,0.7)":"transparent" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
                    <div style={{ flex:1,minWidth:140 }}>
                      <div style={{ fontWeight:700,fontSize:13,marginBottom:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                        {s.name}
                        <span style={{ fontSize:10,fontWeight:700,color:prefCol,background:prefCol+"15",padding:"1px 7px",borderRadius:10,border:`1px solid ${prefCol}33` }}>{prefLbl}</span>
                      </div>
                      <div style={{ fontSize:11,color:"#64748b" }}>{s.country} · {s.products}</div>
                    </div>
                    <Btn sm outline onClick={()=>openFirmPreview(s)} style={{ fontSize:10 }}><Eye size={10}/> Podgląd</Btn>
                    <div style={{ display:"flex",gap:5 }}>
                      {[["want","✅ Chcę","#059669"],["chance","🤝 Daj szansę","#d97706"]].map(([val,lbl,col])=>(
                        <button key={val} onClick={()=>setResp(s.id,val)}
                          style={{ padding:"6px 12px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",border:`${resp===val?"2":"1"}px solid ${resp===val?col:"#e2e8f0"}`,background:resp===val?col+"15":"white",color:resp===val?col:"#64748b" }}>
                          {lbl}
                        </button>
                      ))}
                      <button onClick={()=>setRemoveDialog(s.id)}
                        style={{ padding:"6px 12px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",
                          border:`${resp==="remove"?"2":"1"}px solid ${resp==="remove"?"#dc2626":"#e2e8f0"}`,
                          background:resp==="remove"?"#fef2f2":"white",color:resp==="remove"?"#dc2626":"#94a3b8" }}>
                        ❌ Nie chcę
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
        }
      </Card>
    </div>
  );

  // FAZA 3: zamknięcie wyborów — inline rendering (no inner components to avoid React reconciliation issues)
  if (phase === 3 && !pub) {
    const hasPreview  = !!(previewFor?.chains || []).includes(chainId);
    const lateEnabled = !!((retailers||[]).find(r=>r.fm26ChainId===chainId)?.lateSelectionEnabled);
    const myLateResps = (fmLateResps||{})[chainId] || {};
    const planData3   = pickFMPlan(fmSchedule, fmAlgo);
    const previewMatches = _suppliers.filter(s => planData3?.res?.[s.id]?.m?.includes(chainId));

    return (
      <div style={{ maxWidth:900 }}>

        {/* ── Status banner: always shown in phase 3 ── */}
        <div style={{ padding:"14px 18px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,marginBottom:16,display:"flex",gap:12,alignItems:"flex-start" }}>
          <div style={{ width:36,height:36,borderRadius:"50%",background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:18 }}>⚙️</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700,fontSize:14,color:"#334155",marginBottom:4 }}>Wybory zamknięte — plan w przygotowaniu</div>
            <div style={{ fontSize:13,color:"#64748b",lineHeight:1.65 }}>
              Wybory zostały zamknięte <strong>16 września</strong>. Administrator układa i koryguje plan spotkań.<br/>
              Finalne numery i harmonogram spotkań zostaną opublikowane <strong>22 września 2026</strong>.<br/>
              W sprawie zmian lub pytań napisz do administratora przez <strong>Chat ↘</strong>.
            </div>
          </div>
        </div>

        {/* ── Preview roboczy (jeśli admin włączył) ── */}
        {hasPreview && (
          <div style={{ marginBottom:16 }}>
            <div style={{ padding:"10px 14px",background:"#fef3c7",border:"2px solid #f59e0b",borderRadius:10,marginBottom:12,display:"flex",gap:8,alignItems:"flex-start" }}>
              <span style={{ fontSize:16,flexShrink:0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight:700,fontSize:12,color:"#92400e" }}>Podgląd roboczy — plan może jeszcze ulec zmianie</div>
                <div style={{ fontSize:11,color:"#92400e",marginTop:1 }}>Administrator udostępnił Ci wstępny podgląd planowanych spotkań. <strong>Nie jest to jeszcze finalny plan.</strong> Oficjalna publikacja nastąpi <strong>22 września 2026</strong>.</div>
              </div>
            </div>
            <Card title="Wstępny podgląd — planowane spotkania z Twoją siecią" icon={Eye}>
              {previewMatches.length===0
                ? <div style={{ padding:24,textAlign:"center",color:"#94a3b8",fontSize:12 }}>Brak planowanych spotkań dla tej sieci w planie roboczym.</div>
                : previewMatches.map(s=>{
                    const n=planData3?.nums?.[s.id]?.[chainId];
                    const zk=fmNZ(n);
                    const zc=zk?FM_NZS[zk]:null;
                    return(
                      <div key={s.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 8px",borderBottom:"1px solid #f1f5f9" }}>
                        <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:13 }}>{s.name}</div><div style={{ fontSize:11,color:"#64748b" }}>{s.country} · {s.products}</div></div>
                        {zc&&<span style={{fontSize:11,fontWeight:600,color:zc.c,padding:"2px 8px",borderRadius:6,background:zc.bg,border:`1px solid ${zc.b}`}}>{n?`#${n} · `:""}{zk==="green"?"🟢 Dobra":zk==="orange"?"🟠 Średnia":"🔴 Późna"}</span>}
                      </div>
                    );
                  })
              }
            </Card>
          </div>
        )}

        {/* ── Twoje wybory z Fazy 2 (read-only, zawsze widoczne) ── */}
        <Card title="Twoje odpowiedzi z Fazy Preferencji — tylko do wglądu" icon={CheckCircle}>
          <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>
            Poniżej widzisz odpowiedzi, które udzieliłaś/udzieliłeś podczas Fazy Preferencji. Są zablokowane — edycja możliwa tylko przez administratora.
          </div>
          {allParticipants.length === 0
            ? <div style={{ padding:24,textAlign:"center",color:"#94a3b8" }}>Brak danych o dostawcach.</div>
            : allParticipants.map(s => {
                const resp = myResps[s.id];
                if (!resp) return null; // show only suppliers with a response
                const col = resp==="want"?"#059669":resp==="chance"?"#d97706":"#dc2626";
                const lbl = resp==="want"?"✅ Chcę się spotkać":resp==="chance"?"🤝 Daj szansę":"❌ Nie chcę";
                return (
                  <div key={s.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 6px",borderBottom:"1px solid #f1f5f9" }}>
                    <div style={{ flex:1 }}><div style={{ fontWeight:600,fontSize:13,color:"#1e293b" }}>{s.name}</div><div style={{ fontSize:11,color:"#94a3b8" }}>{s.country} · {s.products}</div></div>
                    <span style={{ fontSize:11,fontWeight:600,color:col,background:col+"10",padding:"3px 10px",borderRadius:20,border:`1px solid ${col}44`,whiteSpace:"nowrap" }}>{lbl}</span>
                  </div>
                );
              }).filter(Boolean)
          }
          {allParticipants.every(s=>!myResps[s.id])&&(
            <div style={{ padding:24,textAlign:"center",color:"#94a3b8",fontSize:12 }}>Brak zaznaczonych odpowiedzi w Fazie Preferencji.</div>
          )}
        </Card>

        {/* ── Wybory po terminie (jeśli admin odblokował dla tej sieci) ── */}
        {lateEnabled && (
          <div style={{ marginTop:16 }}>
            <div style={{ padding:"10px 14px",background:"#fef3c7",border:"2px solid #f59e0b",borderRadius:10,marginBottom:12,display:"flex",gap:8,alignItems:"flex-start" }}>
              <span style={{ fontSize:16,flexShrink:0 }}>⏰</span>
              <div>
                <div style={{ fontWeight:700,fontSize:12,color:"#92400e" }}>Wybory po terminie — tylko informacja dla administratora</div>
                <div style={{ fontSize:11,color:"#92400e",marginTop:1 }}>
                  Twoje odpowiedzi <strong>nie biorą już udziału w algorytmie</strong> i nie zmieniają automatycznie planu spotkań. Służą wyłącznie jako materiał pomocniczy dla administratora.
                </div>
              </div>
            </div>
            <Card title="Wybór dostawców — po terminie (informacja dla admina)" icon={Users}>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>Zaznacz dostawców, z którymi chciałbyś się spotkać. Administrator zdecyduje, czy będzie to możliwe.</div>
              {_suppliers.map(s => {
                const resp = myLateResps[s.id];
                return (
                  <div key={s.id} style={{ padding:"10px 6px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:10 }}>
                    <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:13 }}>{s.name}</div><div style={{ fontSize:11,color:"#64748b" }}>{s.country} · {s.products}</div></div>
                    <div style={{ display:"flex",gap:5 }}>
                      {[["want","✅ Chcę","#059669"],["chance","🤝 Daj szansę","#d97706"]].map(([val,lbl,col])=>(
                        <button key={val}
                          onClick={()=>setLateResp(s.id, val)}
                          style={{ padding:"5px 11px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",border:`${resp===val?"2":"1"}px solid ${resp===val?col:"#e2e8f0"}`,background:resp===val?col+"15":"white",color:resp===val?col:"#64748b" }}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        )}

      </div>
    );
  }

  // FAZA 4+: plan po korektach / oczekiwanie na publikację lub plan finalny
  const planData = pickFMPlan(fmSchedule, fmAlgo);
  const finalMatches = (planData ? _suppliers.filter(s => planData?.res?.[s.id]?.m?.includes(chainId)) : myMatches)
    .slice().sort((a,b)=>{
      if(!pub) return 0; // don't sort before publication
      const numA = planData?.nums?.[a.id]?.[chainId] || 9999;
      const numB = planData?.nums?.[b.id]?.[chainId] || 9999;
      return Number(numA)-Number(numB);
    });

  return (
    <div style={{ maxWidth:800 }}>
      {previewFirm&&<CompanyPreviewModal co={previewFirm} offers={offers} sends={sends} role="buyer" buyerRetailerId={CHAIN_TO_RETAILER[chainId]||null} onClose={()=>setPreviewFirm(null)}/>}
      {phBanner}

      {/* Firmy z którymi się spotykasz */}
      <Card title={pub?"1. Firmy z którymi się spotykasz — plan finalny":"1. Firmy z którymi się spotykasz — plan roboczy"} icon={CheckCircle}>
        {!pub&&<Alrt type="info">Plan jest w trakcie finalizacji przez administratora. Finalna lista zostanie opublikowana 22 września.</Alrt>}
        {finalMatches.length===0
          ? <div style={{ padding:20,textAlign:"center",color:"#94a3b8" }}>Brak przypisanych firm.</div>
          : finalMatches.map((s,i)=>{
              const slotNum = pub ? (planData?.nums?.[s.id]?.[chainId]) : null;
              const zone = slotNum ? (slotNum<=25?"green":slotNum<=35?"orange":"red") : null;
              const zc = zone ? FM_NZS[zone] : null;
              return (
                <div key={s.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 8px",borderBottom:"1px solid #f1f5f9",borderRadius:pub&&zc?8:0,background:pub&&zc?zc.bg:"transparent",marginBottom:pub?4:0 }}>
                  {pub&&slotNum ? <NumBadge num={slotNum} size="md"/> : <div style={{ width:32,height:32,borderRadius:"50%",background:"#f0fdfa",border:"1.5px solid #0d9488",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#0d9488",flexShrink:0 }}>{i+1}</div>}
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700,fontSize:13 }}>{s.name}</div>
                    <div style={{ fontSize:11,color:"#64748b" }}>{s.country} · {s.products}</div>
                  </div>
                  {pub&&<Badge color="#059669">✓ Finalne</Badge>}
                  <Btn sm outline onClick={()=>openFirmPreview(s)} style={{ fontSize:10 }}><Eye size={10}/> Podgląd</Btn>
                </div>
              );
            })
        }
      </Card>

      {/* Firmy z którymi chciałbyś się jeszcze spotkać */}
      <Card title="2. Firmy z którymi chciałbyś się jeszcze spotkać" icon={Heart}>
        <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>
          Zaznacz dodatkowe firmy — to informacja dla administratora. Nie zmienia automatycznie planu.
          {pub&&<span style={{ color:"#d97706" }}> Administrator może uwzględnić te życzenia.</span>}
        </div>
        {_suppliers.filter(s=>!finalMatches.find(m=>m.id===s.id)).map(s=>{
          const inWish = wishList.includes(s.id);
          return (
            <div key={s.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 6px",borderBottom:"1px solid #f1f5f9",background:inWish?"#f0fdf4":"transparent" }}>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:12,fontWeight:500,color:"#1e293b" }}>{s.name}</div>
                <div style={{ fontSize:10,color:"#94a3b8" }}>{s.country} · {s.products}</div>
              </div>
              <Btn sm outline onClick={()=>openFirmPreview(s)} style={{ fontSize:10 }}><Eye size={10}/></Btn>
              <button onClick={()=>toggleWish(s.id)} style={{ padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",border:`${inWish?"2":"1"}px solid ${inWish?"#059669":"#e2e8f0"}`,background:inWish?"#f0fdf4":"white",color:inWish?"#059669":"#64748b" }}>
                {inWish?"✅ Zgłoszono":"+ Chcę"}
              </button>
            </div>
          );
        })}
        {wishList.length>0&&<div style={{ marginTop:10,padding:"8px 12px",background:"#eff6ff",borderRadius:7,fontSize:12,color:"#1e40af",border:"1px solid #bfdbfe" }}>
          Zgłoszono {wishList.length} dodatkow{wishList.length===1?"ą firmę":"e firmy"} administratorowi. Oksana Kozłowska wprowadzi korekty ręcznie jeśli będzie to możliwe.
        </div>}
        {pub&&<div style={{ marginTop:10,fontSize:12,color:"#64748b",paddingTop:8,borderTop:"1px solid #e2e8f0" }}>
          W sprawie zmian skontaktuj się: <strong>Oksana Kozłowska</strong> · oksana@freshmarket.eu · +48 603 811 818
        </div>}
      </Card>

      {pub&&<FMVenueFooter extra={"Twoje stoisko — dowiesz się w recepcji eventu.\nStart rejestracji: 8:00–9:00."}/>}

    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   FM PAGE — ADMIN
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   FM BUILD DATA — pełny algorytm z numerami kolejkowymi
   (prefs/resps z globalnego stanu, generuje nums + cq)
═══════════════════════════════════════════════════════════════ */
const FM_MO = "'JetBrains Mono',monospace";
const FM_NZS = {
  green:  { c:"#059669", bg:"#f0fdf4", b:"#bbf7d0" },
  orange: { c:"#d97706", bg:"#fffbeb", b:"#fde68a" },
  red:    { c:"#dc2626", bg:"#fee2e2", b:"#fca5a5" },
};
function fmNZ(n) {
  if (!n || n <= 0) return null; // no slot assigned yet — caller handles null
  if (n <= 25) return "green";
  if (n <= 35) return "orange";
  return "red";
}

function buildFMData(prefs, resps, chains, suppliers) {
  const _chains    = chains    || FM_CHAINS;
  const _suppliers = (suppliers && suppliers.length > 0) ? suppliers : FM_SUPPLIERS;
  const FM_MAX_MEETINGS = 5;
  const FM_MAX_SLOTS    = 60;

  /* ── Sort: Premium first, then Business, then paymentDate asc ── */
  const sorted = [..._suppliers].sort((a, b) => {
    const tier = { Premium: 0, Business: 1 };
    const ta = tier[a.pkg] ?? 2, tb = tier[b.pkg] ?? 2;
    if (ta !== tb) return ta - tb;
    const da = a.paymentDate || a.paidAt || "";
    const db = b.paymentDate || b.paidAt || "";
    if (da && db) return da < db ? -1 : da > db ? 1 : 0;
    if (da) return -1;
    if (db) return  1;
    return (a._sortIdx ?? 999) - (b._sortIdx ?? 999);
  });

  /* ── Init ── */
  const res = {};
  const cs  = {};
  _suppliers.forEach(s => { res[s.id] = { m: [], r: {} }; });
  _chains.forEach(ch => { cs[ch.id] = { n: 0, list: [] }; });

  const canAssign = (sid, cid) =>
    cs[cid] !== undefined &&
    res[sid].m.length < FM_MAX_MEETINGS &&
    cs[cid].n < FM_MAX_SLOTS &&
    !res[sid].m.includes(cid);

  const assign = (sid, cid, rd) => {
    if (!canAssign(sid, cid)) return false;
    res[sid].m.push(cid);
    res[sid].r[cid] = rd;
    cs[cid].n++;
    cs[cid].list.push(sid);
    return true;
  };

  /*
   * ════════════════════════════════════════════════════════════
   * MATCHING — NETWORK CHOICE IS SUPREME
   * Priority:
   *   R1: chain answered ✅ (want) — regardless of supplier pref (star/thumb)
   *   R2: chain answered 🤝 (chance) — regardless of supplier pref
   *   ❌ (remove) = no meeting
   * Within each round: sorted order (Premium → Business → paymentDate)
   * ════════════════════════════════════════════════════════════
   */

  /* R1 — chain wants meeting (✅), any supplier pref except remove */
  sorted.forEach(s => {
    _chains.forEach(ch => {
      const chainResp   = resps[ch.id]?.[s.id];
      const supplierPref = prefs[s.id]?.[ch.id];
      if (chainResp === "want" && supplierPref !== undefined && supplierPref !== "remove")
        assign(s.id, ch.id, 1);
    });
  });

  /* R2 — chain gives chance (🤝), supplier has any pref except remove */
  /* Prioritise suppliers with fewer meetings so far */
  [...sorted]
    .sort((a, b) => res[a.id].m.length - res[b.id].m.length)
    .forEach(s => {
      if (res[s.id].m.length >= FM_MAX_MEETINGS) return;
      _chains.forEach(ch => {
        const chainResp   = resps[ch.id]?.[s.id];
        const supplierPref = prefs[s.id]?.[ch.id];
        if (chainResp === "chance" && supplierPref !== undefined && supplierPref !== "remove")
          assign(s.id, ch.id, 2);
      });
    });

  /*
   * ════════════════════════════════════════════════════════════
   * SCHEDULING — unique slot numbers, placement rules:
   *   meeting #1 → must land in 1–10
   *   meeting #2 → must land in 11–20
   *   meeting #3+ → try 1–10, then 11–20, then 20+ (fallback)
   *   uniqueness: supplier never gets the same number in two chains
   *   ordering: sorted (Premium → Business → paymentDate) gets earlier slots
   * ════════════════════════════════════════════════════════════
   */
  const nums = {};
  const cq   = {};
  const used = {}; // slot numbers this supplier already occupies across ALL chains
  _suppliers.forEach(s => { nums[s.id] = {}; used[s.id] = new Set(); });
  _chains.forEach(ch => {
    cq[ch.id] = new Array(Math.max(cs[ch.id].n + 10, 60)).fill(null);
  });

  const findSlot = (cid, lo, hi, usedSet) => {
    if (!cq[cid]) return -1;
    const limit = Math.min(hi, cq[cid].length);
    for (let p = lo; p < limit; p++) {
      if (cq[cid][p] === null && !usedSet.has(p + 1)) return p;
    }
    return -1;
  };

  const placeAt = (sid, cid, bp) => {
    cq[cid][bp] = sid;
    used[sid].add(bp + 1);
    nums[sid][cid] = bp + 1;
  };

  const place = (sid, cid, lo, hi) => {
    let bp = findSlot(cid, lo, hi, used[sid]);
    if (bp === -1) bp = findSlot(cid, 0, cq[cid].length, used[sid]);
    if (bp === -1) { bp = cq[cid].length; cq[cid].push(null); }
    placeAt(sid, cid, bp);
  };

  sorted.forEach(s => {
    const mtgs = res[s.id].m;
    if (mtgs.length === 0) return;

    mtgs.forEach((cid, i) => {
      if (i === 0) {
        // 1st meeting MUST be in 1–10
        place(s.id, cid, 0, 10);
      } else if (i === 1) {
        // 2nd meeting MUST be in 11–20
        place(s.id, cid, 10, 20);
      } else {
        // 3rd+ : try 1–10 first, then 11–20, then 20+
        let bp = findSlot(cid, 0, 10, used[s.id]);
        if (bp !== -1) { placeAt(s.id, cid, bp); return; }
        bp = findSlot(cid, 10, 20, used[s.id]);
        if (bp !== -1) { placeAt(s.id, cid, bp); return; }
        place(s.id, cid, 20, cq[cid].length);
      }
    });
  });

  return { res, cs, nums, cq };
}

/* ═══════════════════════════════════════════════════════════════
   FM ADMIN CORRECTION PANEL — interaktywny grid
═══════════════════════════════════════════════════════════════ */
function FMAdminCorrectionPanel({ data, setData, onApprove, retailers, fmChains, fmSuppliers, fmWishlists, fmResps }) {
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const _resps     = fmResps || {};
  const [selA, setSelA] = useState(null);
  const [swapLog, setSwapLog] = useState([]);
  const [filterChain, setFilterChain] = useState("all");
  const [approved, setApproved] = useState(false);
  // [B2B Round FM-buyer-rejection-logic] Pending placement awaiting admin
  // confirmation when target chain's buyer rejected the supplier.
  // Shape: { rejections: [{sid, cid, supplierName, chainName}], commit: () => void }
  const [pendingOverride, setPendingOverride] = useState(null);

  if (!data || !data.cq) return (
    <div style={{ padding:40,textAlign:"center",color:"#94a3b8" }}>
      <RefreshCw size={28} style={{ marginBottom:10,display:"block",margin:"0 auto 10px",opacity:0.3 }}/>
      Dane nie są jeszcze wygenerowane
    </div>
  );

  const visibleChains = filterChain === "all"
    ? _chains
    : _chains.filter(c => c.id === filterChain);
  const maxRows = Math.max(..._chains.map(c => (data.cq[c.id] || []).filter(x => x).length), 20);

  // [B2B Round FM-buyer-rejection-logic] Lookup for "did this buyer/chain reject
  // this supplier?". Buyer-side reject is stored as fm_resps.zone === "remove"
  // (see PageBuyerFM modal "Nie chcę spotkania z tą firmą" → setResp(sid,"remove")).
  const isBuyerRejected = (cid, sid) => _resps?.[cid]?.[sid] === "remove";
  const isManualOverride = (sid, cid) => Boolean(data?.overrides?.[sid]?.[cid]);

  const handleClick = (cid, pos) => {
    if (approved) return;
    const sid = (data.cq[cid] || [])[pos] || null;
    if (!selA) {
      if (!sid) return;
      setSelA({ cid, pos, sid });
      return;
    }
    if (selA.cid === cid && selA.pos === pos) { setSelA(null); return; }

    const newCq = {};
    _chains.forEach(c => { newCq[c.id] = [...(data.cq[c.id] || [])]; });
    const a = selA;
    let logMsg = "";

    if (sid) {
      newCq[a.cid][a.pos] = sid;
      newCq[cid][pos] = a.sid;
      const nA = (_suppliers.find(x => x.id === a.sid) || {}).name || "?";
      const nB = (_suppliers.find(x => x.id === sid) || {}).name || "?";
      const chA = (_chains.find(x => x.id === a.cid) || {}).name;
      const chB = (_chains.find(x => x.id === cid) || {}).name;
      logMsg = `🔄 Zamiana: ${nA} (${chA} #${a.pos+1}) ↔ ${nB} (${chB} #${pos+1})`;
    } else {
      newCq[a.cid][a.pos] = null;
      newCq[cid][pos] = a.sid;
      const nA = (_suppliers.find(x => x.id === a.sid) || {}).name || "?";
      const chName = (_chains.find(x => x.id === cid) || {}).name || "?";
      logMsg = `➡️ Przesunięcie: ${nA} → ${chName} #${pos+1}`;
    }

    // [B2B Round FM-buyer-rejection-logic] Detect rejected pairings created by
    // this swap. A pair is "newly rejected" if (1) supplier ends up in a chain
    // they weren't already in, AND (2) that chain's buyer flagged them as
    // remove. Pre-existing rejections (e.g. previous override) aren't re-flagged.
    const wasInChain = (s, c) => (data.cq[c] || []).includes(s);
    const rejections = [];
    if (a.sid !== sid) {
      // a.sid moves into cid
      if (!wasInChain(a.sid, cid) && isBuyerRejected(cid, a.sid) && !isManualOverride(a.sid, cid)) {
        rejections.push({
          sid: a.sid, cid,
          supplierName: (_suppliers.find(x => x.id === a.sid) || {}).name || a.sid,
          chainName: (_chains.find(x => x.id === cid) || {}).name || cid,
        });
      }
      // sid moves into a.cid (if swap)
      if (sid && !wasInChain(sid, a.cid) && isBuyerRejected(a.cid, sid) && !isManualOverride(sid, a.cid)) {
        rejections.push({
          sid, cid: a.cid,
          supplierName: (_suppliers.find(x => x.id === sid) || {}).name || sid,
          chainName: (_chains.find(x => x.id === a.cid) || {}).name || a.cid,
        });
      }
    }

    // Function that actually applies the move. Reused from confirm-callback path.
    const commit = () => {
      const newNums = {};
      _suppliers.forEach(s => { newNums[s.id] = {}; });
      _chains.forEach(c => {
        (newCq[c.id] || []).forEach((sid2, p) => {
          if (sid2 && newNums[sid2]) newNums[sid2][c.id] = p + 1;
        });
      });
      const newRes = {};
      _suppliers.forEach(s => {
        newRes[s.id] = { m: [], r: (data?.res?.[s.id]?.r || {}) };
      });
      _chains.forEach(ch => {
        (newCq[ch.id] || []).forEach(sid2 => {
          if (sid2 && newRes[sid2]) newRes[sid2].m.push(ch.id);
        });
      });
      // [B2B Round FM-buyer-rejection-logic] Persist override flag in
      // data.overrides[sid][cid] = "manually_added_despite_buyer_rejection"
      // so all downstream views (plan, admin pipeline) can mark this pair.
      const newOverrides = JSON.parse(JSON.stringify(data?.overrides || {}));
      rejections.forEach(({ sid: rSid, cid: rCid }) => {
        if (!newOverrides[rSid]) newOverrides[rSid] = {};
        newOverrides[rSid][rCid] = "manually_added_despite_buyer_rejection";
      });
      setData(prev => ({ ...prev, cq: newCq, nums: newNums, res: newRes, overrides: newOverrides }));
      setSwapLog(prev => [
        ...rejections.map(r => `⚠️ Dodano mimo odrzucenia: ${r.supplierName} → ${r.chainName}`),
        logMsg,
        ...prev,
      ].slice(0, 20));
      setSelA(null);
    };

    if (rejections.length > 0) {
      setPendingOverride({ rejections, commit });
    } else {
      commit();
    }
  };

  const totalMeetings = _suppliers.reduce((a, s) => a + (data?.res?.[s.id]?.m?.length || 0), 0);

  return (
    <div>
      {/* [B2B Round FM-buyer-rejection-logic] Manual override confirmation modal.
          Shown when admin tries to place a supplier into a chain whose buyer
          flagged that supplier as "remove" (Nie chcę spotkania). Admin must
          consciously confirm and the resulting meeting gets the
          "manually_added_despite_buyer_rejection" override flag. */}
      {pendingOverride && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div style={{ background:"white",borderRadius:14,padding:24,maxWidth:520,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:10,color:"#dc2626",display:"flex",alignItems:"center",gap:8 }}>
              <AlertTriangle size={18}/> Uwaga — odrzucenie przez kupca
            </div>
            <div style={{ fontSize:13,color:"#334155",marginBottom:14,lineHeight:1.65 }}>
              {pendingOverride.rejections.length === 1 ? (
                <>
                  Sieć <strong>{pendingOverride.rejections[0].chainName}</strong> oznaczyła dostawcę{" "}
                  <strong>{pendingOverride.rejections[0].supplierName}</strong> jako <strong>NIE CHCĘ SPOTKANIA</strong>.
                  Czy mimo to chcesz ręcznie dodać spotkanie?
                </>
              ) : (
                <>
                  Następujące pary zostały oznaczone przez kupców jako <strong>NIE CHCĘ SPOTKANIA</strong>:
                  <ul style={{ margin:"8px 0 0 18px",padding:0 }}>
                    {pendingOverride.rejections.map((r,i)=>(
                      <li key={i} style={{ marginTop:4 }}><strong>{r.supplierName}</strong> → <strong>{r.chainName}</strong></li>
                    ))}
                  </ul>
                  Czy mimo to chcesz ręcznie dodać te spotkania?
                </>
              )}
            </div>
            <div style={{ fontSize:11,color:"#64748b",marginBottom:18,padding:"8px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8 }}>
              ℹ️ Po zatwierdzeniu pary zostaną oznaczone w systemie jako <strong>DODANE RĘCZNIE MIMO ODRZUCENIA</strong> i będą widoczne z ikoną ⚠️ w pipelinie i podglądzie planu.
            </div>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <button onClick={()=>setPendingOverride(null)}
                style={{ padding:"10px 18px",borderRadius:8,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
                Anuluj
              </button>
              <button onClick={()=>{ pendingOverride.commit(); setPendingOverride(null); }}
                style={{ padding:"10px 18px",borderRadius:8,border:"none",background:"#dc2626",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
                Dodaj mimo odrzucenia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      {!approved ? (
        <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10 }}>
          <div>
            <div style={{ fontSize:13,fontWeight:700,color:"#92400e" }}>⚠️ Harmonogram niezatwierdzony</div>
            <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>Skoryguj numerację, a następnie zatwierdź plan. Po zatwierdzeniu edycja zostaje zablokowana.</div>
          </div>
          <button onClick={()=>{ setApproved(true); if(typeof onApprove==="function") onApprove(data); }}
            style={{ padding:"10px 24px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#059669,#047857)",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap" }}>
            ✅ Zatwierdź plan
          </button>
        </div>
      ) : (
        <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <div style={{ fontSize:13,fontWeight:700,color:"#059669" }}>✅ ZATWIERDZONY — gotowy do wysyłki do uczestników</div>
          <Btn outline sm onClick={()=>setApproved(false)} style={{ color:"#dc2626",borderColor:"#fca5a5",fontSize:11 }}>Odblokuj edycję</Btn>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14 }}>
        {[
          [_suppliers.length,"Dostawców","#0d9488"],
          [_chains.length,"Sieci","#2563eb"],
          [totalMeetings,"Spotkań","#059669"],
          [swapLog.length,"Zmian admina","#d97706"],
        ].map(([v,l,c])=>(
          <div key={l} style={{ padding:"10px 14px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center" }}>
            <div style={{ fontSize:20,fontWeight:800,color:c }}>{v}</div>
            <div style={{ fontSize:10,color:"#64748b",marginTop:1 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Wishlista sieci — zgłoszenia dodatkowych firm */}
      {(() => {
        const wEntries = _chains.filter(ch => (fmWishlists[ch.id] || []).length > 0);
        if (!wEntries.length) return null;
        return (
          <div style={{ marginBottom:16,padding:"14px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10 }}>
            <div style={{ fontWeight:700,fontSize:13,color:"#1e40af",marginBottom:10,display:"flex",alignItems:"center",gap:6 }}>
              <span>📝</span> Zgłoszenia dodatkowe od Sieci (Wishlista)
            </div>
            <div style={{ fontSize:12,color:"#1e40af",marginBottom:10 }}>
              Poniższe sieci handlowe zgłosiły prośby o dodanie firm do ich planu. Możesz uwzględnić je ręcznie w gridzie.
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {wEntries.map(ch => {
                const sids = fmWishlists[ch.id] || [];
                const names = sids.map(sid => (_suppliers.find(s=>s.id===sid)||{}).name || sid).filter(Boolean);
                return (
                  <div key={ch.id} style={{ padding:"8px 12px",background:"white",borderRadius:8,border:"1px solid #bfdbfe" }}>
                    <span style={{ fontWeight:700,fontSize:12,color:"#1e40af" }}>{ch.name}</span>
                    <span style={{ fontSize:12,color:"#334155" }}> prosi o dodanie: </span>
                    {names.map((n, i) => (
                      <span key={i} style={{ fontSize:12,fontWeight:600,color:"#059669",background:"#f0fdf4",padding:"1px 7px",borderRadius:10,margin:"0 2px",border:"1px solid #bbf7d0" }}>{n}</span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Controls */}
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap" }}>
        <div style={{ fontWeight:700,fontSize:13,color:"#1e293b",display:"flex",alignItems:"center",gap:6 }}>
          <Sliders size={14} color="#0d9488"/> Panel korekty numerów
        </div>
        <select value={filterChain} onChange={e=>setFilterChain(e.target.value)}
          style={{ padding:"5px 10px",borderRadius:7,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit",background:"white" }}>
          <option value="all">Wszystkie sieci ({_chains.length})</option>
          {_chains.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selA && !approved && (
          <div style={{ display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8 }}>
            <span style={{ fontSize:12,color:"#92400e",fontWeight:600 }}>
              ✋ Zaznaczono: <strong>{(_suppliers.find(x=>x.id===selA.sid)||{}).name}</strong>
            </span>
            <span style={{ fontSize:11,color:"#64748b" }}>— kliknij drugą komórkę aby zamienić / przesunąć</span>
            <button onClick={()=>setSelA(null)} style={{ background:"none",border:"none",cursor:"pointer",color:"#dc2626",padding:"0 4px" }}><X size={12}/></button>
          </div>
        )}
      </div>

      {/* GRID */}
      <div style={{ overflowX:"auto",border:"1px solid #e2e8f0",borderRadius:12,marginBottom:12 }}>
        <table style={{ borderCollapse:"collapse",fontSize:11,whiteSpace:"nowrap",minWidth:"100%" }}>
          <thead>
            <tr style={{ background:"#f8fafc" }}>
              <th style={{ padding:"8px 10px",textAlign:"center",color:"#64748b",position:"sticky",left:0,background:"#f8fafc",zIndex:2,borderRight:"2px solid #e2e8f0",minWidth:36,fontSize:10,textTransform:"uppercase" }}>#</th>
              {visibleChains.map(c=>(
                <th key={c.id} style={{ padding:"8px 7px",textAlign:"center",color:"#475569",fontWeight:700,minWidth:90,borderRight:"1px solid #e2e8f0",fontSize:10 }}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(maxRows + 5, 45) }, (_, row) => {
              const zone = fmNZ(row + 1);
              const zc = FM_NZS[zone];
              return (
                <tr key={row} style={{ background: row % 2 ? "#fafafa" : "white" }}>
                  <td style={{ padding:"5px 8px",textAlign:"center",fontFamily:FM_MO,fontWeight:700,color:zc.c,position:"sticky",left:0,background:row%2?"#fafafa":"white",zIndex:1,borderRight:"2px solid #e2e8f0",fontSize:12 }}>{row+1}</td>
                  {visibleChains.map(c=>{
                    const queue = data.cq[c.id] || [];
                    const sid = queue[row] || null;
                    const sup = sid ? _suppliers.find(x=>x.id===sid) : null;
                    const isSel = selA && selA.cid===c.id && selA.pos===row;
                    const isTarget = !isSel && selA && !approved;
                    // Highlight same supplier across all chains
                    const isSameSup = !isSel && selA && sid === selA.sid;
                    // [B2B Round FM-buyer-rejection-logic] Mark cells where the
                    // pair was added despite buyer rejection (via the manual
                    // override flow above).
                    const isOverride = sid && isManualOverride(sid, c.id);
                    return (
                      <td key={c.id}
                        onClick={()=>!approved && handleClick(c.id, row)}
                        title={isOverride ? "Dodane ręcznie mimo odrzucenia przez kupca" : undefined}
                        style={{ padding:"4px 6px",cursor:approved?"default":(sid||selA)?"pointer":"default",background:isSel?"#fef9c3":isSameSup?"#fef3c7":isOverride?"#fee2e2":isTarget&&!sid?"#f0fdfa":"transparent",outline:isSel?"2px solid #fbbf24":isSameSup?"2px solid #f59e0b":isOverride?"1px dashed #dc2626":"none",borderRight:"1px solid #f1f5f9",transition:"background 0.1s" }}>
                        {sup ? (
                          <div style={{ display:"flex",alignItems:"center",gap:3 }}>
                            {isOverride && <span style={{ fontSize:11,color:"#dc2626" }}>⚠️</span>}
                            <span style={{ width:6,height:6,borderRadius:3,background:sup.pkg==="Premium"?"#d97706":"#3b82f6",flexShrink:0 }}/>
                            <span style={{ color:"#1e293b",fontWeight:sup.pkg==="Premium"?700:500,overflow:"hidden",textOverflow:"ellipsis",maxWidth:80,display:"inline-block" }}>{sup.name}</span>
                          </div>
                        ) : (
                          isTarget
                            ? <span style={{ color:"#bbf7d0",fontSize:10 }}>↓</span>
                            : <span style={{ color:"#f1f5f9" }}>·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend + instructions */}
      <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" }}>
        {Object.entries(FM_NZS).map(([k,v])=>(
          <span key={k} style={{ padding:"3px 10px",borderRadius:6,background:v.bg,border:`1px solid ${v.b}`,fontSize:11,fontWeight:600,color:v.c }}>
            {k==="green"?"🟢 1–25 dobra pozycja":k==="orange"?"🟠 26–35 średnia":"🔴 36+ późna"}
          </span>
        ))}
        <span style={{ fontSize:11,color:"#94a3b8",marginLeft:4 }}>· Żółta kropka = Premium · Niebieska = Business</span>
      </div>
      <div style={{ padding:"10px 14px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,color:"#64748b",marginBottom:14 }}>
        <strong style={{ color:"#1e293b" }}>Jak używać:</strong> Kliknij firmę (podświetli się na żółto) → kliknij inną firmę = <strong>zamiana numerów</strong>. Kliknij firmę → kliknij puste pole (↓) = <strong>przesunięcie na wcześniejsze miejsce</strong>.
      </div>

      {/* Swap log */}
      {swapLog.length > 0 && (
        <Card title="📋 Log zmian admina" icon={FileText}>
          {swapLog.map((l,i)=>(
            <div key={i} style={{ fontSize:12,color:"#64748b",padding:"4px 0",borderBottom:"1px solid #f1f5f9" }}>{l}</div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ALGORITHM TRIGGER CARD — admin button to run matching + schedule
═══════════════════════════════════════════════════════════════ */
function AlgorithmTriggerCard({ fmSettings, setFmSettings, fmPrefs, fmResps, fmAlgo, retailers, fmChains, fmSuppliers }) {
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const phase = fmSettings.currentPhase;

  // Count how many suppliers have filled preferences (>=5 stars)
  const suppliersDone = _suppliers.filter(s => {
    const p = fmPrefs[s.id] || {};
    return Object.values(p).filter(v=>v==="star").length >= 5;
  }).length;

  // Count how many chains have responded to at least some suppliers
  const chainsDone = _chains.filter(c => {
    const r = fmResps[c.id] || {};
    return Object.values(r).some(hasBuyerResponse);
  }).length;

  const totalMeetings = fmAlgo ? Object.values(fmAlgo.res).reduce((a,r)=>a+r.m.length,0) : 0;
  const readyToRun = phase === 2 && suppliersDone >= Math.floor(_suppliers.length * 0.5);
  const alreadyRan = phase >= 3 && totalMeetings > 0;

  function runAlgorithm() {
    setRunning(true);
    setTimeout(() => {
      setRunning(false);
      setDone(true);
      // Move to phase 3
      setFmSettings(s => ({ ...s, currentPhase: 3, schedulingOpen: true }));
      setTimeout(() => setDone(false), 4000);
    }, 1800);
  }

  return (
    <div style={{ background:alreadyRan?"#f0fdf4":readyToRun?"#fffbeb":"#f8fafc",border:`2px solid ${alreadyRan?"#bbf7d0":readyToRun?"#fde68a":"#e2e8f0"}`,borderRadius:14,padding:"20px 22px",marginBottom:0 }}>
      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14 }}>
        <div style={{ width:44,height:44,borderRadius:12,background:alreadyRan?"#059669":readyToRun?"#d97706":"#94a3b8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>
          {alreadyRan?"✅":readyToRun?"⚡":"🔒"}
        </div>
        <div>
          <div style={{ fontSize:15,fontWeight:800,color:"#1e293b" }}>Algorytm matchingu — Faza 3</div>
          <div style={{ fontSize:12,color:"#64748b",marginTop:2 }}>
            {alreadyRan
              ? `Algorytm uruchomiony · ${totalMeetings} spotkań wygenerowanych`
              : readyToRun
                ? "Wystarczająca liczba preferencji — możesz uruchomić algorytm"
                : "Oczekiwanie na preferencje dostawców i odpowiedzi sieci"
            }
          </div>
        </div>
      </div>

      {/* Progress stats */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16 }}>
        {[[suppliersDone+"/"+_suppliers.length,"Dostawców gotowych","#0d9488"],[chainsDone+"/"+_chains.length,"Sieci odpowiedziało","#2563eb"],[totalMeetings,"Spotkań w planie","#7c3aed"]].map(([v,l,c])=>(
          <div key={l} style={{ padding:"10px 12px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center" }}>
            <div style={{ fontSize:20,fontWeight:800,color:c }}>{v}</div>
            <div style={{ fontSize:10,color:"#64748b",marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Phase status */}
      <div style={{ display:"flex",gap:6,marginBottom:16,flexWrap:"wrap" }}>
        {FM_PHASES.map(ph=>(
          <div key={ph.id} style={{ display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,background:phase>=ph.id?ph.color+"15":"#f1f5f9",border:`1px solid ${phase>=ph.id?ph.color+"55":"#e2e8f0"}` }}>
            <div style={{ width:6,height:6,borderRadius:"50%",background:phase>=ph.id?ph.color:"#e2e8f0" }}/>
            <span style={{ fontSize:10,fontWeight:phase===ph.id?700:500,color:phase>=ph.id?ph.color:"#94a3b8" }}>{ph.label}</span>
          </div>
        ))}
      </div>

      {/* Action */}
      {done ? (
        <div style={{ padding:"14px 18px",background:"#f0fdf4",border:"2px solid #bbf7d0",borderRadius:10,display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:20 }}>🎉</span>
          <div>
            <div style={{ fontWeight:700,fontSize:14,color:"#059669" }}>Algorytm zakończony!</div>
            <div style={{ fontSize:12,color:"#64748b" }}>Plan spotkań gotowy. Widok przełączony na Fazę 3. Dostawcy i kupcy widzą wyniki.</div>
          </div>
        </div>
      ) : alreadyRan ? (
        <div style={{ display:"flex",gap:8,alignItems:"center" }}>
          <div style={{ padding:"10px 18px",background:"#059669",color:"white",borderRadius:10,fontWeight:700,fontSize:13,display:"flex",gap:6,alignItems:"center" }}>
            <CheckCircle size={14}/> Plan spotkań aktywny — Faza {phase}
          </div>
          <button onClick={runAlgorithm}
            style={{ padding:"10px 18px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#64748b",fontWeight:600,fontSize:12,cursor:"pointer",display:"flex",gap:6,alignItems:"center" }}>
            <RefreshCw size={13}/> Przebuduj plan
          </button>
        </div>
      ) : readyToRun ? (
        <button onClick={runAlgorithm} disabled={running}
          style={{ padding:"14px 28px",borderRadius:10,border:"none",background:running?"#94a3b8":"linear-gradient(135deg,#7c3aed,#059669)",color:"white",fontWeight:800,fontSize:15,cursor:running?"wait":"pointer",display:"flex",gap:10,alignItems:"center",width:"100%",justifyContent:"center",boxShadow:running?"none":"0 4px 20px rgba(124,58,237,0.4)" }}>
          {running
            ? <><RefreshCw size={16} style={{ animation:"spin 0.8s linear infinite" }}/> Uruchamiam algorytm…</>
            : <><span style={{ fontSize:18 }}>⚡</span> Uruchom algorytm matchingu — Faza 3</>
          }
        </button>
      ) : (
        <div style={{ padding:"12px 16px",background:"#f1f5f9",borderRadius:10,fontSize:12,color:"#94a3b8",display:"flex",gap:8,alignItems:"center" }}>
          <Lock size={14}/>
          Algorytm dostępny gdy co najmniej {Math.floor(_suppliers.length*0.5)} dostawców wypełni preferencje i sieci wyślą odpowiedzi.
          Aktualnie gotowych: <strong style={{ color:suppliersDone>0?"#0d9488":"#dc2626" }}>{suppliersDone} dostawców</strong>, <strong style={{ color:chainsDone>0?"#0d9488":"#dc2626" }}>{chainsDone} sieci</strong>.
        </div>
      )}
    </div>
  );
}

function PageAdminFM({ fmSettings, setFmSettings, fmPrefs, fmResps, setFmResps, fmAlgo, fmSchedule, setFmSchedule, onRegenerate, retailers, setRetailers, fmChains, fmSuppliers, fmWishlists, fmLateResps, previewFor, setPreviewFor, runtimeAccounts, companies }) {
  const _chains    = (fmChains    && fmChains.length    > 0) ? fmChains    : FM_CHAINS;
  const _suppliers = (fmSuppliers && fmSuppliers.length > 0) ? fmSuppliers : FM_SUPPLIERS;
  const [tab, setTab] = useState("zarzadzanie");
  const phase = fmSettings.currentPhase;
  // Full data with slot numbers for Faza 4 admin correction grid
  const [fmFullData, setFmFullData] = useState(() => pickFMPlan(fmSchedule, buildFMData(fmPrefs, fmResps, _chains, _suppliers)));
  // Rebuild when prefs/resps change (e.g. after onRegenerate)
  const rebuildFull = () => setFmFullData(buildFMData(fmPrefs, fmResps, _chains, _suppliers));
  const approveAndPublish = (data) => { setFmSchedule(data); setFmFullData(data); };
  const syncFromSchedule = () => { if(fmSchedule) setFmFullData(fmSchedule); };

  return (
    <div style={{ maxWidth:980 }}>
      <div style={{ display:"flex",gap:0,marginBottom:20,background:"#f1f5f9",borderRadius:10,padding:4,width:"fit-content" }}>
        {[["zarzadzanie","⚙️ Zarządzanie"],["dane","📋 Dane wejściowe"],["plan","⚡ Plan spotkań"],["korekty","✏️ Korekty"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px 18px",borderRadius:8,border:"none",background:tab===t?"white":"transparent",fontWeight:tab===t?600:400,fontSize:12,cursor:"pointer",fontFamily:"inherit",color:tab===t?"#1e293b":"#64748b",boxShadow:tab===t?"0 1px 4px rgba(0,0,0,0.08)":"none",whiteSpace:"nowrap" }}>{l}</button>
        ))}
      </div>

      {/* ══ TAB: ZARZĄDZANIE ══ */}
      {tab==="zarzadzanie" && (
        <div>
          <Card title="Dostęp uczestników" icon={fmSettings.schedulingOpen?Unlock:Lock}>
            <div style={{ display:"flex",gap:12,marginBottom:12 }}>
              <div style={{ padding:"12px 16px",background:fmSettings.schedulingOpen?"#f0fdf4":"#fef2f2",border:`1px solid ${fmSettings.schedulingOpen?"#bbf7d0":"#fca5a5"}`,borderRadius:10,textAlign:"center",flexShrink:0 }}>
                <div style={{ fontSize:22 }}>{fmSettings.schedulingOpen?"🟢":"🔴"}</div>
                <div style={{ fontSize:11,fontWeight:700,color:fmSettings.schedulingOpen?"#059669":"#dc2626",marginTop:2 }}>{fmSettings.schedulingOpen?"OTWARTA":"ZAMKNIĘTA"}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11,color:"#64748b",display:"block",marginBottom:4 }}>Data planowanego otwarcia</label>
                  <input type="date" value={fmSettings.openDate} onChange={e=>setFmSettings(s=>({...s,openDate:e.target.value}))} style={{ padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,fontFamily:"inherit" }}/>
                </div>
                <div style={{ display:"flex",gap:8 }}>
                  <Btn primary onClick={()=>setFmSettings(s=>({...s,schedulingOpen:true}))} disabled={fmSettings.schedulingOpen} style={{ background:"#059669" }}><Unlock size={13}/> Otwórz dostęp</Btn>
                  <Btn outline onClick={()=>setFmSettings(s=>({...s,schedulingOpen:false}))} disabled={!fmSettings.schedulingOpen} style={{ color:"#dc2626",borderColor:"#fca5a5" }}><Lock size={13}/> Zamknij</Btn>
                </div>
              </div>
            </div>
            <Alrt type="info">Zakładka „Spotkania FM 2026" widoczna w sidebarze <strong>cały czas</strong>. Gdy zamknięta — uczestnicy widzą ekran blokady z datą otwarcia.</Alrt>
          </Card>
          <Card title="Publikacja planu finalnego" icon={Send}>
            <div style={{ display:"flex",gap:12,marginBottom:12 }}>
              <div style={{ padding:"12px 16px",background:fmSettings.planPublished?"#f0fdf4":"#fef2f2",border:`1px solid ${fmSettings.planPublished?"#bbf7d0":"#fca5a5"}`,borderRadius:10,textAlign:"center",flexShrink:0 }}>
                <div style={{ fontSize:22 }}>{fmSettings.planPublished?"✅":"📋"}</div>
                <div style={{ fontSize:11,fontWeight:700,color:fmSettings.planPublished?"#059669":"#dc2626",marginTop:2 }}>{fmSettings.planPublished?"OPUBLIKOWANY":"NIEOPUBLIKOWANY"}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13,color:"#334155",marginBottom:8,lineHeight:1.65 }}>
                  {fmSettings.planPublished
                    ? "Plan finalny opublikowany. Dostawcy i kupcy widzą swoje spotkania z numerami kolejkowymi."
                    : "Po opublikowaniu planu dostawcy i kupcy zobaczy zakladke Twoje spotkania z finalnymi numerami. Ta operacja jest nieodwracalna."
                  }
                </div>
                <div style={{ display:"flex",gap:8 }}>
                  <Btn primary onClick={()=>setFmSettings(s=>({...s,planPublished:true}))} disabled={fmSettings.planPublished} style={{ background:"#059669" }}><Send size={13}/> Opublikuj plan finalny</Btn>
                  {fmSettings.planPublished&&<Btn outline onClick={()=>setFmSettings(s=>({...s,planPublished:false}))} style={{ color:"#dc2626",borderColor:"#fca5a5" }}>Cofnij publikację (demo)</Btn>}
                </div>
              </div>
            </div>
            {!fmSettings.planPublished&&<Alrt type="warning">Przed publikacją upewnij się, że plan spotkań jest zatwierdzony. Po opublikowaniu dostawcy i kupcy natychmiast zobaczą finalne numery spotkań.</Alrt>}
          </Card>
          <Card title="Dane testowe" icon={RefreshCw}>
            <div style={{ fontSize:12,color:"#64748b",marginBottom:10 }}>Regeneruj syntetyczne preferencje i odpowiedzi sieci</div>
            <div style={{ display:"flex",gap:8,alignItems:"center" }}>
              <Btn outline sm onClick={onRegenerate}><RefreshCw size={12}/> Nowy zestaw danych</Btn>
              <span style={{ fontSize:11,color:"#94a3b8" }}>{_suppliers.length} dostawców · {_chains.length} sieci</span>
            </div>
          </Card>
          <Card title="Fazy organizacyjne Fresh Market 2026" icon={Calendar}>
            <div style={{ fontSize:12,color:"#64748b",marginBottom:14 }}>Kliknij fazę żeby ją aktywować. Aktywna faza odblokowuje odpowiednie funkcje dla dostawców i sieci.</div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {FM_PHASES.map(ph=>{
                const isActive = fmSettings.currentPhase === ph.id;
                const isDone   = fmSettings.currentPhase > ph.id;
                return (
                  <div key={ph.id} onClick={()=>setFmSettings(s=>({...s,currentPhase:ph.id,schedulingOpen:ph.id>=2?true:s.schedulingOpen}))}
                    style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,cursor:"pointer",
                      border:`2px solid ${isActive?ph.color:isDone?"#e2e8f0":"#e2e8f0"}`,
                      background:isActive?ph.color+"12":isDone?"#f8fafc":"white",
                      transition:"all 0.15s" }}>
                    <div style={{ width:28,height:28,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                      background:isActive?ph.color:isDone?"#059669":"#e2e8f0",
                      color:"white",fontWeight:800,fontSize:13 }}>
                      {isDone?"✓":ph.id}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700,fontSize:13,color:isActive?ph.color:isDone?"#059669":"#334155" }}>{ph.label}</div>
                      <div style={{ fontSize:11,color:"#64748b",marginTop:1 }}>{ph.sub} · <span style={{ color:"#94a3b8" }}>{ph.dates}</span></div>
                    </div>
                    {isActive&&<span style={{ fontSize:11,fontWeight:700,color:ph.color,background:ph.color+"18",padding:"3px 10px",borderRadius:20 }}>● AKTYWNA</span>}
                    {isDone&&<span style={{ fontSize:11,color:"#059669" }}>Zakończona</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ══ TAB: DANE WEJŚCIOWE ══ */}
      {tab==="dane" && (()=>{
        const _sr = _suppliers.filter(s=>_chains.filter(c=>fmPrefs[s.id]?.[c.id]==="star").length>=5).length;
        const _cr = _chains.filter(c=>_suppliers.some(s=>hasBuyerResponse(fmResps[c.id]?.[s.id]))).length;
        const _rp = Math.round((_sr/Math.max(_suppliers.length,1))*100);
        const noPickSuppliers = _suppliers.filter(s => Object.keys(fmPrefs[s.id]||{}).length === 0);
        const noRespChains = _chains.filter(c => !_suppliers.some(s => hasBuyerResponse(fmResps[c.id]?.[s.id])));
        // [B2B Round supplier-FM-UX] Confirmation tracking. A supplier is
        // "confirmed" when their company row has fm_selection_confirmed_at set.
        // Resolution by fmId/legacy_supplier_id/sup-<fmId> covers all the
        // supplier-key formats Round 5 introduced.
        const findCo = (s) => (companies || []).find(c =>
          c.fmId === s.id || c.legacy_fm_id === s.id ||
          c.legacy_supplier_id === s.id || c.legacy_supplier_id === ("sup-" + (s.id || ""))
        );
        const confirmedSuppliers = _suppliers.filter(s => findCo(s)?.fm_selection_confirmed_at);
        const unconfirmedReady = _suppliers.filter(s => {
          const isReady = _chains.filter(c => fmPrefs[s.id]?.[c.id]==="star").length >= 5;
          return isReady && !findCo(s)?.fm_selection_confirmed_at;
        });
        if (_suppliers.length === 0 && _chains.length === 0) {
          return <div style={{padding:30,textAlign:"center",color:"#94a3b8",background:"white",borderRadius:12,border:"1px solid #e2e8f0"}}>Dane wejściowe nie są jeszcze kompletne — brak dostawców i sieci.</div>;
        }
        return (
          <div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:14 }}>
              {[
                [_sr+"/"+_suppliers.length,"Dostawców gotowych","#d97706"],
                [confirmedSuppliers.length+"/"+_suppliers.length,"✓ Potwierdzonych","#059669"],
                [_suppliers.length-_sr,"Nie wybrało","#dc2626"],
                [_cr+"/"+_chains.length,"Sieci odpow.","#2563eb"],
                [_rp+"%","Gotowość",_rp>=50?"#059669":"#d97706"]
              ].map(([v,l,c])=>(
                <div key={l} style={{ padding:"12px 14px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center",borderTop:`3px solid ${c}` }}>
                  <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
                  <div style={{ fontSize:10,color:"#64748b",marginTop:2 }}>{l}</div>
                </div>
              ))}
            </div>
            {_rp < 50 && <Alrt type="warning">Tylko {_sr}/{_suppliers.length} dostawców wypełniło preferencje ({_rp}%). Rozważ poczekanie z uruchomieniem algorytmu.</Alrt>}
            {unconfirmedReady.length > 0 && <Alrt type="info">{unconfirmedReady.length} {unconfirmedReady.length===1?"dostawca ma":"dostawców ma"} 5 głównych sieci ale nie kliknął/-li jeszcze przycisku "Potwierdź wybór" — wybór nie jest finalny.</Alrt>}
            {(noPickSuppliers.length > 0 || noRespChains.length > 0 || unconfirmedReady.length > 0) && (
              <div style={{display:"grid",gridTemplateColumns:`repeat(${[noPickSuppliers,noRespChains,unconfirmedReady].filter(a=>a.length>0).length},1fr)`,gap:10,marginBottom:14}}>
                {noPickSuppliers.length > 0 && (
                  <div style={{padding:"12px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#991b1b",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>Dostawcy bez żadnych wyborów ({noPickSuppliers.length})</div>
                    <div style={{fontSize:11,color:"#7f1d1d",lineHeight:1.6,maxHeight:120,overflowY:"auto"}}>{noPickSuppliers.map(s=>s.name).join(" · ")}</div>
                  </div>
                )}
                {unconfirmedReady.length > 0 && (
                  <div style={{padding:"12px 14px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#1e40af",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>Gotowi, ale nie potwierdzili ({unconfirmedReady.length})</div>
                    <div style={{fontSize:11,color:"#1e3a8a",lineHeight:1.6,maxHeight:120,overflowY:"auto"}}>{unconfirmedReady.map(s=>s.name).join(" · ")}</div>
                  </div>
                )}
                {noRespChains.length > 0 && (
                  <div style={{padding:"12px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>Sieci bez odpowiedzi ({noRespChains.length})</div>
                    <div style={{fontSize:11,color:"#78350f",lineHeight:1.6,maxHeight:120,overflowY:"auto"}}>{noRespChains.map(c=>c.name).join(" · ")}</div>
                  </div>
                )}
              </div>
            )}
            <FMAdminPreferencesView fmPrefs={fmPrefs} fmResps={fmResps} retailers={retailers} fmChains={_chains} fmSuppliers={_suppliers} companies={companies}/>
          </div>
        );
      })()}

      {/* ══ TAB: PLAN SPOTKAŃ ══ */}
      {tab==="plan" && (
        <div>
          <AlgorithmTriggerCard fmSettings={fmSettings} setFmSettings={setFmSettings} fmPrefs={fmPrefs} fmResps={fmResps} fmAlgo={fmAlgo} retailers={retailers} fmChains={_chains} fmSuppliers={_suppliers} setFmSchedule={setFmSchedule}/>
          {(fmFullData||fmSchedule) && (
            <div style={{ marginTop:16 }}>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14 }}>
                {(()=>{const _plan=pickFMPlan(fmSchedule,fmAlgo);const _resVals=Object.values(_plan?.res||{});return [[_suppliers.length,"Dostawców","#0d9488"],[_chains.length,"Sieci","#2563eb"],[_resVals.reduce((a,r)=>a+(r?.m?.length||0),0),"Spotkań","#059669"],[_resVals.filter(r=>(r?.m?.length||0)>=5).length,"Pełnych planów","#7c3aed"]];})().map(([v,l,c])=>(
                  <div key={l} style={{ padding:"12px",background:"white",border:"1px solid #e2e8f0",borderRadius:10,textAlign:"center",borderTop:`3px solid ${c}` }}>
                    <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
                    <div style={{ fontSize:10,color:"#64748b",marginTop:2 }}>{l}</div>
                  </div>
                ))}
              </div>
              <Card title="Dostawcy — plan spotkań" noPad>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                    <thead><tr style={{ background:"#f8fafc" }}>{["Firma","Pakiet","Spotkań","Sieci"].map(h=><th key={h} style={{ padding:"8px 12px",textAlign:"left",color:"#64748b",borderBottom:"1px solid #e2e8f0",fontWeight:600,fontSize:10,textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
                    <tbody>{_suppliers.map(s=>{
                      const _plan=pickFMPlan(fmSchedule,fmAlgo);
                      const mRaw=_plan?.res?.[s.id]?.m||[];
                      const mNums=_plan?.nums?.[s.id]||{};
                      const m=[...mRaw].sort((a,b)=>(Number(mNums[a])||9999)-(Number(mNums[b])||9999));
                      // [B2B Round FM-buyer-rejection-logic] Mark chain names
                      // with ⚠️ if the meeting was added despite buyer rejection.
                      const overrides = _plan?.overrides?.[s.id] || {};
                      const chainCells = m.map(cid=>{
                        const ch = _chains.find(c=>c.id===cid);
                        const name = ch?.name || cid;
                        return overrides[cid] ? `⚠️ ${name}` : name;
                      }).join(", ") || "—";
                      const overrideCount = Object.keys(overrides).filter(cid => mRaw.includes(cid)).length;
                      return(
                        <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9", background: overrideCount > 0 ? "#fef2f2" : "transparent" }} title={overrideCount > 0 ? `${overrideCount} ${overrideCount===1?"spotkanie dodane":"spotkania dodane"} mimo odrzucenia przez kupca` : undefined}>
                          <td style={{ padding:"8px 12px",fontWeight:600 }}>{s.name}{overrideCount>0 && <span style={{ marginLeft:6,fontSize:10,fontWeight:700,color:"#dc2626" }}>⚠️ {overrideCount}</span>}</td>
                          <td style={{ padding:"8px 12px" }}><Badge color={s.pkg==="Premium"?"#d97706":"#2563eb"}>{s.pkg}</Badge></td>
                          <td style={{ padding:"8px 12px",fontWeight:700,color:m.length>=5?"#059669":m.length>=3?"#d97706":"#dc2626" }}>{m.length}/{FM_MAX_M}</td>
                          <td style={{ padding:"8px 12px",color:"#64748b",fontSize:11 }}>{chainCells}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
          <div style={{marginTop:12,textAlign:"right"}}>
            <Btn outline onClick={()=>setTab("korekty")}>✏️ Przejdź do korekt numerów →</Btn>
          </div>
        </div>
      )}

      {tab==="korekty" && (
        <div>
          {phase < 3 && (
            <div style={{padding:"14px 18px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
              <div style={{fontSize:18,flexShrink:0}}>⚠️</div>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:"#92400e",marginBottom:3}}>Korekty dostępne od Fazy 3 (Algorytm Matchingu)</div>
                <div style={{fontSize:12,color:"#b45309",lineHeight:1.6}}>Aktualnie aktywna: <strong>{FM_PHASES[(phase||1)-1]?.label}</strong>. Przejdź do zakładki <strong>Zarządzanie</strong> i aktywuj fazę 3 — Algorytm + Korekty.</div>
              </div>
            </div>
          )}
          {phase === 3 && (
            <div style={{padding:"12px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,marginBottom:16,fontSize:12,color:"#1e40af"}}>
              ℹ️ <strong>Faza 3 — Praca Administratora (17–21 września).</strong> Ręcznie koryguj plan i zatwierdź go przed 22 września. Uczestnicy nie mają już własnych korekt — mogą zgłaszać uwagi wyłącznie przez chat.
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>Korekty numerów kolejkowych</div>
              <div style={{fontSize:12,color:"#64748b"}}>Ręczna zmiana kolejności spotkań. Dostępna od uruchomienia algorytmu do publikacji finalnego harmonogramu (22 września).</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {fmSchedule&&<Btn outline sm onClick={syncFromSchedule} style={{color:"#059669",borderColor:"#bbf7d0"}}><CheckCircle size={12}/> Wczytaj zatwierdzony</Btn>}
              <Btn outline sm onClick={rebuildFull}><RefreshCw size={12}/> Przebuduj z preferencji</Btn>
            </div>
          </div>
          <div style={{opacity:phase>=3?1:0.4,pointerEvents:phase>=3?"auto":"none",transition:"opacity 0.2s"}}>
            <FMAdminCorrectionPanel data={fmFullData} setData={setFmFullData} onApprove={(d)=>{ approveAndPublish(d); setTab("plan"); }} retailers={retailers} fmChains={_chains} fmSuppliers={_suppliers} fmWishlists={fmWishlists||{}} fmResps={fmResps}/>
          </div>
          {/* Preview For + Late Selection controls — UNDER correction panel */}
          <div style={{marginBottom:16,padding:"14px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10}}>
            <div style={{fontWeight:700,fontSize:13,color:"#1e40af",marginBottom:8,display:"flex",alignItems:"center",gap:6}}><Eye size={14}/> Podgląd planowanych spotkań (roboczy)</div>
            <div style={{fontSize:11,color:"#3b82f6",marginBottom:12}}>Włącz podgląd dla wybranego uczestnika — zobaczy wstępny plan z dopiskiem "Wersja robocza — może ulec zmianie przed 22 września".</div>
            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:180}}>
                <div style={{fontWeight:600,fontSize:11,color:"#334155",marginBottom:6,textTransform:"uppercase"}}>Dostawcy</div>
                <div style={{maxHeight:160,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
                  {_suppliers.map(s=>{const enabled=(previewFor?.suppliers||[]).includes(s.id);return(
                    <label key={s.id} style={{display:"flex",alignItems:"center",gap:7,padding:"4px 6px",borderRadius:6,cursor:"pointer",fontSize:12,background:enabled?"rgba(37,99,235,0.06)":"transparent"}}>
                      <input type="checkbox" checked={enabled} onChange={()=>setPreviewFor&&setPreviewFor(p=>({...p,suppliers:enabled?p.suppliers.filter(x=>x!==s.id):[...(p.suppliers||[]),s.id]}))} style={{width:13,height:13,accentColor:"#2563eb"}}/>
                      {s.name}
                    </label>
                  );})}
                </div>
              </div>
              <div style={{flex:1,minWidth:180}}>
                <div style={{fontWeight:600,fontSize:11,color:"#334155",marginBottom:6,textTransform:"uppercase"}}>Sieci handlowe</div>
                <div style={{maxHeight:160,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
                  {_chains.map(ch=>{
                    const enabled=(previewFor?.chains||[]).includes(ch.id);
                    const lateEnabled=(retailers||[]).find(r=>r.fm26ChainId===ch.id)?.lateSelectionEnabled;
                    return(
                      <div key={ch.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",borderRadius:6,background:enabled?"rgba(37,99,235,0.06)":"transparent"}}>
                        <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:12,flex:1}}>
                          <input type="checkbox" checked={enabled} onChange={()=>setPreviewFor&&setPreviewFor(p=>({...p,chains:enabled?p.chains.filter(x=>x!==ch.id):[...(p.chains||[]),ch.id]}))} style={{width:13,height:13,accentColor:"#2563eb"}}/>
                          {ch.name}
                        </label>
                        <label title="Odblokuj wybór po terminie dla tej sieci" style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:lateEnabled?"#d97706":"#94a3b8",whiteSpace:"nowrap"}}>
                          <input type="checkbox" checked={!!lateEnabled} onChange={()=>setRetailers&&setRetailers(prev=>prev.map(r=>r.fm26ChainId!==ch.id?r:{...r,lateSelectionEnabled:!lateEnabled}))} style={{width:12,height:12,accentColor:"#d97706"}}/>
                          ⏰ Po terminie
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Late resps section */}
          {(()=>{
            const lateEntries=_chains.filter(ch=>Object.keys((fmLateResps||{})[ch.id]||{}).length>0);
            if(!lateEntries.length) return null;
            return(
              <div style={{marginBottom:16,padding:"14px 16px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10}}>
                <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:8}}>⏰ Odpowiedzi po terminie — tylko do ręcznych korekt</div>
                <div style={{fontSize:11,color:"#92400e",marginBottom:10}}>Poniższe sieci zgłosiły wybory PO terminie 16 września. Nie biorą udziału w algorytmie.</div>
                {lateEntries.map(ch=>{
                  const resps=(fmLateResps||{})[ch.id]||{};
                  const wantIds=Object.entries(resps).filter(([,v])=>v==="want").map(([k])=>k);
                  const chanceIds=Object.entries(resps).filter(([,v])=>v==="chance").map(([k])=>k);
                  const removeIds=Object.entries(resps).filter(([,v])=>v==="remove").map(([k])=>k);
                  return(
                    <div key={ch.id} style={{padding:"8px 12px",background:"white",borderRadius:8,border:"1px solid #fde68a",marginBottom:6}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#92400e",marginBottom:4}}>{ch.name}</div>
                      {wantIds.length>0&&<div style={{fontSize:11,color:"#059669"}}>✅ Chcę: {wantIds.map(sid=>(_suppliers.find(s=>s.id===sid)||{}).name||sid).join(", ")}</div>}
                      {chanceIds.length>0&&<div style={{fontSize:11,color:"#d97706",marginTop:2}}>🤝 Daj szansę: {chanceIds.map(sid=>(_suppliers.find(s=>s.id===sid)||{}).name||sid).join(", ")}</div>}
                      {removeIds.length>0&&<div style={{fontSize:11,color:"#dc2626",marginTop:2}}>❌ Nie chcę: {removeIds.map(sid=>(_suppliers.find(s=>s.id===sid)||{}).name||sid).join(", ")}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
