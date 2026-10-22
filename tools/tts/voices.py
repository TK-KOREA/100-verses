"""읽어주기 목소리 설계. 키 하나가 Gemini 음성 + 연출 지시 한 벌이다.

모두 같은 바탕을 지킨다:
- 듣는 사람은 5~12살 아이, 들은 대로 따라 말하고 외운다. 또박또박, 어절 끝을 흐리지 않는다.
- 성경 말씀이라 우스꽝스럽거나 연극처럼 과장하지 않는다. 설교단 목소리도 아니다.
- [short pause]마다 분명히 쉰다(덩어리 시간표를 이 쉼으로 뽑는다).
"""

COMMON_RULES = (
    "Korean children's Bible memory verse. The listener is a 5 to 12 year old child who will repeat "
    "the words back and memorize them. Pronounce every syllable clearly, never swallow word endings, "
    "and keep the reading faithful to the text: no added words, no sound effects, no singing. "
    "Wherever the transcript says [short pause], stop speaking for about half a second, "
    "so each phrase stands on its own."
)

VOICES = {
    "teacher": {
        "name": "어린이 봉사자",
        "who": "아이들 둘레에 앉아 읽어 주는 다정한 봉사자",
        "voice": "Sulafat",
        "style": "A warm Sunday school teacher reading a memory verse to a small circle of children sitting on the floor. A gentle smile in the voice, kind and encouraging.",
        "voice_desc": "Warm mid-range female voice, soft but clear, rounded consonants, no breathiness.",
        "scene": "A bright, cozy classroom on Sunday morning. The children lean in to listen.",
        "pace": "Calm and unhurried, a little slower than conversation, steady from start to finish.",
        "tone": "Kind, assuring, quietly joyful. Phrase endings settle softly instead of dropping away.",
    },
    "sister": {
        "name": "다정한 언니",
        "who": "동생에게 읽어 주는 밝은 고등학생 언니",
        "voice": "Leda",
        "style": "A bright, friendly older sister in high school reading a verse to her younger sibling, cheerful and patient.",
        "voice_desc": "Youthful, light female voice with clean vowels and a lively but controlled lift.",
        "scene": "Sitting side by side on the sofa after school, sharing one book.",
        "pace": "Clear and even, never rushed, slightly lively between phrases.",
        "tone": "Friendly and sincere, a little playful warmth, never childish or sing-song.",
    },
    "dad": {
        "name": "든든한 아빠",
        "who": "자기 전에 읽어 주는 다정한 아빠",
        "voice": "Achird",
        "style": "A gentle, dependable dad reading a verse to his child before bed, warm and steady.",
        "voice_desc": "Friendly lower-mid male voice, relaxed and clear, warm resonance, no gravel.",
        "scene": "A child's room in the evening, a small lamp on, the child tucked in and listening.",
        "pace": "Relaxed and steady, generous pauses, slower than normal speech.",
        "tone": "Safe, calm, affectionate. Confident without sounding stern.",
    },
    "clear": {
        "name": "또박또박 선생님",
        "who": "따라 말하기를 이끄는 또렷한 여자 선생님",
        "voice": "Kore",
        "style": "A clear, articulate teacher leading a repeat-after-me memory drill. Each phrase is modeled carefully so the children can copy it exactly.",
        "voice_desc": "Firm, clean female voice, precise diction, bright but not sharp.",
        "scene": "A quiet classroom. After each phrase the children will say it back.",
        "pace": "Deliberate and evenly spaced, every phrase given its own clear shape.",
        "tone": "Encouraging and focused, warm authority, never cold.",
    },

    # 따뜻한 엄마: 2026-10-22 이야기 할아버지(Algieba) 대신
    "mom": {
        "name": "따뜻한 엄마",
        "who": "아이 곁에서 차분히 읽어 주는 엄마",
        "voice": "Vindemiatrix",
        "style": "A loving mother reading a memory verse to her child at the kitchen table, gentle and patient, a soft smile in her voice.",
        "voice_desc": "Warm, calm mid-range female voice, smooth and clear, tender but not breathy.",
        "scene": "A quiet afternoon at home. The child sits close and repeats after her.",
        "pace": "Calm and even, slightly slower than conversation, clear space between phrases.",
        "tone": "Affectionate, reassuring, steady. Phrase endings settle warmly.",
    },
}
