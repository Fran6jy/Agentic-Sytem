import { useEffect, useState } from "react";
import { Download, PlusSquare, Share, X } from "lucide-react";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

// iPadOS reports itself as a Mac, so also check for touch.
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Android/desktop Chrome get the native install prompt; iOS gets Add to Home Screen steps.
export default function InstallApp() {
  const [deferred, setDeferred] = useState(null);
  const [showIosSheet, setShowIosSheet] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  const ios = isIos();

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!deferred && !ios)) return null;

  const install = async () => {
    if (ios) {
      setShowIosSheet(true);
      return;
    }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  return (
    <>
      <button type="button" className="install-button" onClick={install}>
        <Download size={16} />
        <span>{ios ? "Add to Home Screen" : "Install app"}</span>
      </button>

      {showIosSheet ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setShowIosSheet(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="ios-install-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="sheet-close" onClick={() => setShowIosSheet(false)} aria-label="Close">
              <X size={18} />
            </button>
            <img src="/icons/icon-192.png" alt="" width="64" height="64" />
            <h2 id="ios-install-title">Put Chalk Lab on your Home Screen</h2>
            <ol>
              <li><span className="sheet-step">1</span> Tap <Share size={17} aria-label="Share" /> <strong>Share</strong> in Safari's toolbar.</li>
              <li><span className="sheet-step">2</span> Scroll down and tap <PlusSquare size={17} aria-hidden="true" /> <strong>Add to Home Screen</strong>.</li>
              <li><span className="sheet-step">3</span> Tap <strong>Add</strong>. Chalk Lab opens full screen, like an app.</li>
            </ol>
            <p className="sheet-note">Using Chrome on iPhone? Open this page in Safari first.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
