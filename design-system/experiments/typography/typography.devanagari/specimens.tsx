/** Preview-only specimens for typography.devanagari. Never imported by the app. Sample copy only — not reviewed translations. */
import * as React from "react";

import { Eyebrow, Lede, ListGroup, ListRow, PageHeading } from "@/components/creatorco";

export const SHARED = {
  HindiSample: () => (
    <div lang="hi" className="min-h-full bg-paper p-5 text-ink">
      <Eyebrow className="mb-1">सदस्यता आवेदन द्वारा</Eyebrow>
      <PageHeading>आपका क्रिएटर पासपोर्ट</PageHeading>
      <Lede className="mt-2">
        आपका कानूनी नाम केवल CreatorCo के पास निजी रहता है। आप अपनी जानकारी कभी भी बदल सकते हैं।
      </Lede>
      <ListGroup
        id="hi-signals"
        label="पेशेवर संकेत"
        className="mt-6"
        footer="आपके क्रिएटर व्यवसाय के बारे में — यह क्रेडिट स्कोर नहीं है।"
      >
        <ListRow label="क्रिएटर गतिविधि" detail="1 जुड़ा हुआ खाता" value="सत्यापित" />
        <ListRow label="कुल दर्शक" value="46.7 हज़ार" />
      </ListGroup>
      <p className="mt-6 text-subhead text-ink-muted">
        CreatorCo आपके द्वारा दिए गए विवरणों का उपयोग केवल आपकी क्रिएटर प्रोफ़ाइल बनाने और आपको दिखाने के लिए करेगा।
      </p>
    </div>
  ),
};
export const AFTER = {};
