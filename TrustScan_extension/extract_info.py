import spacy
import re

nlp = spacy.load("en_core_web_sm")

SUSPICIOUS_WORDS = [
    "fake", "fraud", "unverified", "scam", "unauthorized",
    "unreal", "imposter", "invalid", "bogus", "cheat"
]

SKILL_PATTERN = re.compile(
    r"\b(?:C\+\+|C#|Python|Java|JavaScript|React(?:JS)?|Node(?:\.js)?|"
    r"HTML|CSS|Kotlin|Swift|Flutter|Django|SQL|Machine Learning|"
    r"Deep Learning|AI|Data Science|NLP|Cybersecurity|Linux|"
    r"TensorFlow|PyTorch)\b", re.I
)

# Common company/educational keywords
EDU_KEYWORDS = r"university|college|institute|school|technical|mission|engineering|technology|academy"

text = """
RB worked at OpenAI and Netflix as a Machine Learning Engineer.
He studied at Mahatma Gandhi Mission College of Engineering and Technology Noida, affiliated with (Dr. APJ Abdul Kalam Technical University).
He knows C++, Python, ReactJS, SQL, and Cybersecurity.
He once mentioned 'FakeSystems Ltd' but it sounded suspicious.
"""

doc = nlp(text)

companies, universities, skills, suspicious = set(), set(), set(), set()

# Extract skills using regex
for match in re.findall(SKILL_PATTERN, text):
    skills.add(match.strip())

# Check for suspicious words (including within compound words)
for token in doc:
    token_lower = token.text.lower()
    for sus_word in SUSPICIOUS_WORDS:
        if sus_word in token_lower:
            suspicious.add(token.text)
            break

# Helper function to check if text contains skills
def contains_skill(text):
    """Check if text contains any known skills"""
    text_lower = text.lower()
    for skill in skills:
        if skill.lower() in text_lower:
            return True
    # Also check against common skill patterns
    if re.search(r"c\+\+|python|java|react|sql|html|css", text_lower):
        return True
    return False

# Extract organizations and universities from NER
for ent in doc.ents:
    if ent.label_ == "ORG":
        name = ent.text.strip()
        
        # Skip if it contains skills (like "C++, Python, ReactJS")
        if contains_skill(name):
            continue
            
        # Skip if it contains commas (likely a list, not a single entity)
        if "," in name:
            continue
        
        # Check if it's an educational institution
        if re.search(EDU_KEYWORDS, name, re.I):
            universities.add(name)
        else:
            # Skip if suspicious
            if not any(sus in name.lower() for sus in SUSPICIOUS_WORDS):
                companies.add(name)

# Smart heuristic for missed companies
for i, token in enumerate(doc):
    if token.text[0].isupper() and len(token.text) > 2:
        word = token.text
        prev = doc[i-1].text.lower() if i > 0 else ""
        prev2 = doc[i-2].text.lower() if i > 1 else ""
        
        # Check if previous word is "and" and the word before that was a company trigger
        # Example: "at OpenAI and Netflix"
        if prev == "and" and i >= 2:
            prev_prev = doc[i-2].text
            if prev_prev[0].isupper() and prev2 in ["at", "from", "for", "joined", "with"]:
                # This is likely part of a company list
                if not re.search(EDU_KEYWORDS, word, re.I) and not contains_skill(word):
                    companies.add(word)
                    continue
        
        # Trigger words that indicate company context
        if prev in ["at", "from", "for", "joined", "with"]:
            # Skip if it's part of an educational phrase like "studied at"
            if prev2 in ["studied", "enrolled", "graduated"]:
                continue
            
            # Exclude if it's an educational term
            if re.search(EDU_KEYWORDS, word, re.I):
                continue
            
            # Exclude if it's a known skill or contains skills
            if contains_skill(word):
                continue
            
            # Exclude if it's suspicious
            if any(sus in word.lower() for sus in SUSPICIOUS_WORDS):
                continue
            
            # Exclude very short words
            if len(word) < 3:
                continue
                
            companies.add(word)

# Remove any skills that might have slipped through
companies = {c for c in companies if not contains_skill(c)}

# Remove educational terms from companies
companies = {c for c in companies if not re.search(EDU_KEYWORDS, c, re.I)}

print("-" * 40)
print("Companies:", sorted(list(companies)))
print("Universities:", sorted(list(universities)))
print("Skills:", sorted(list(skills)))
print("Suspicious Words:", sorted(list(suspicious)))
print("-" * 40)