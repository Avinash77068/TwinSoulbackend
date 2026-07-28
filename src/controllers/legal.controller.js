// Static legal copy served from the backend so it can be updated without an
// app release. No user-specific data — public, no auth required.

const PRIVACY_POLICY = {
  updatedAt: '2026-01-01',
  sections: [
    {
      title: '1. Information We Collect',
      body: 'We collect the information you provide when creating an account (name, email, profile photo) and the content you and your partner create together within the app (messages, memories, diary entries, goals).',
    },
    {
      title: '2. How We Use Your Information',
      body: 'Your information is used to operate core features — connecting you with your partner, syncing messages and shared content, and sending notifications about activity in your private space.',
    },
    {
      title: '3. Data Sharing',
      body: "Content you create is only ever shared with the partner you're connected to. We do not sell your personal data to third parties.",
    },
    {
      title: '4. Data Security',
      body: 'We use industry-standard measures to protect your data, including encrypted network connections and access-controlled storage.',
    },
    {
      title: '5. Your Rights',
      body: 'You can request access to, correction of, or deletion of your data at any time by contacting support from the Help Center.',
    },
    {
      title: '6. Contact Us',
      body: 'Questions about this policy can be sent through the Feedback section in the app menu.',
    },
  ],
};

const TERMS_CONDITIONS = {
  updatedAt: '2026-01-01',
  sections: [
    {
      title: '1. Acceptance of Terms',
      body: 'By creating an account and using SoulSync, you agree to these Terms & Conditions and our Privacy Policy.',
    },
    {
      title: '2. Account & Eligibility',
      body: 'You must provide accurate information when registering. SoulSync connects exactly two people per relationship — you are responsible for keeping your couple code and connection password private.',
    },
    {
      title: '3. Acceptable Use',
      body: 'You agree not to use SoulSync to harass, harm, or impersonate others, or to upload unlawful content. We may suspend accounts that violate these terms.',
    },
    {
      title: '4. Content Ownership',
      body: 'You retain ownership of the messages, photos, and entries you create. You grant us a limited license to store and transmit that content so the app can function.',
    },
    {
      title: '5. Termination',
      body: 'You may leave your relationship or delete your account at any time from Profile settings. We may suspend accounts that breach these terms.',
    },
    {
      title: '6. Changes to These Terms',
      body: 'We may update these terms occasionally. Continued use of the app after changes means you accept the updated terms.',
    },
  ],
};

exports.getPrivacyPolicy = (req, res) => {
  res.json({ success: true, data: PRIVACY_POLICY });
};

exports.getTermsConditions = (req, res) => {
  res.json({ success: true, data: TERMS_CONDITIONS });
};
