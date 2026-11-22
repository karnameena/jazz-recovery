import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./responsive-fixes.css";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import { AccountDeletion } from "./pages/AccountDeletion";
import { SubscriptionPlanRoute } from "./pages/SubscriptionPlanRoute";

const path = window.location.pathname.replace(/\/+$/, "") || "/";

const pageMetadata = path === "/privacy-policy"
  ? {
      title: "Privacy Policy | Jazz Recovery",
      description: "Read how Jazz Recovery processes account, device, location and recovery-photo information, and how to manage your privacy choices.",
      canonical: "https://jazzrecovery.com/privacy-policy",
    }
  : path === "/subscription-plan"
    ? {
        title: "Subscription Plans | Jazz Recovery",
        description: "View Jazz Recovery monthly and yearly subscription plans and learn how registered account holders can securely subscribe.",
        canonical: "https://jazzrecovery.com/subscription-plan",
      }
    : path === "/delete-account"
    ? {
        title: "Delete Your Jazz Recovery Account",
        description: "Verify your existing Jazz Recovery account credentials and permanently request account deletion.",
        canonical: "https://jazzrecovery.com/delete-account",
      }
    : {
        title: "Jazz Recovery | Android Device Recovery Companion",
        description: "Jazz Recovery helps registered owners connect with their paired Android device, view device status, and request recovery actions and recovery updates.",
        canonical: "https://jazzrecovery.com/",
      };

document.title = pageMetadata.title;
const descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (descriptionTag) descriptionTag.content = pageMetadata.description;
const canonicalTag = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
if (canonicalTag) canonicalTag.href = pageMetadata.canonical;
const ogUrlTag = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
if (ogUrlTag) ogUrlTag.content = pageMetadata.canonical;
const ogTitleTag = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
if (ogTitleTag) ogTitleTag.content = pageMetadata.title;
const ogDescriptionTag = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
if (ogDescriptionTag) ogDescriptionTag.content = pageMetadata.description;
const twitterTitleTag = document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]');
if (twitterTitleTag) twitterTitleTag.content = pageMetadata.title;
const twitterDescriptionTag = document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]');
if (twitterDescriptionTag) twitterDescriptionTag.content = pageMetadata.description;
const publicPage = path === "/privacy-policy"
  ? <PrivacyPolicy />
  : path === "/delete-account"
    ? <AccountDeletion />
    : path === "/subscription-plan"
      ? <SubscriptionPlanRoute />
      : <App />;

createRoot(document.getElementById("root")!).render(publicPage);
