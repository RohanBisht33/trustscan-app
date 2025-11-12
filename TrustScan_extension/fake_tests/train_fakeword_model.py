import nltk
import random
import string
import numpy as np
import joblib
import textdistance
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.linear_model import LogisticRegression
from scipy.sparse import hstack
from wordfreq import zipf_frequency

# --- Base directory of this file ---
base_dir = Path(__file__).resolve().parent

# --- Load words ---
nltk.download('words')
from nltk.corpus import words

real_words = set([w.lower() for w in words.words() if w.isalpha() and len(w) > 2])

# --- Generate fake words ---
def generate_fake_word():
    length = random.randint(3, 10)
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(length))

# --- Generate typo-like fakes ---
def typo_like_fake(real_word):
    if len(real_word) < 3:
        return real_word
    w = list(real_word)
    i = random.randint(0, len(w) - 2)
    w[i], w[i + 1] = w[i + 1], w[i]
    return ''.join(w)

# --- Build dataset ---
real_words_sample = random.sample(list(real_words), 6000)
random_fakes = [generate_fake_word() for _ in range(3000)]
typo_fakes = [typo_like_fake(w) for w in random.sample(list(real_words_sample), 3000)]

fake_words = random_fakes + typo_fakes
X = real_words_sample + fake_words
y = [1] * len(real_words_sample) + [0] * len(fake_words)

# --- Vectorizer ---
vectorizer = CountVectorizer(analyzer='char', ngram_range=(2, 4))
X_char = vectorizer.fit_transform(X)

# --- Feature extractor ---
from random import sample

def get_features(word_list):
    feats = []
    # smaller subset of real words for speed
    sample_real = sample(list(real_words), 50)
    for w in word_list:
        vowels = sum(c in "aeiou" for c in w)
        freq = zipf_frequency(w, 'en')
        # rough min distance, faster
        nearest_dist = min(
            textdistance.damerau_levenshtein.distance(w, real) for real in sample_real
        )
        nearest_dist *= 2.0 

        feats.append([
            len(w),
            vowels / len(w) if len(w) else 0,
            freq,
            nearest_dist
        ])
    return np.array(feats)


X_extra = get_features(X)
X_final = hstack([X_char, X_extra])

# --- Train model ---
X_train, X_test, y_train, y_test = train_test_split(
    X_final, y, test_size=0.2, random_state=42
)
model = LogisticRegression(max_iter=1000)
model.fit(X_train, y_train)

print("✅ Model trained with Levenshtein distance!")
print("Accuracy:", model.score(X_test, y_test))

# --- Save model ---
joblib.dump(model, base_dir / "fakeword_model.pkl")
joblib.dump(vectorizer, base_dir / "vectorizer.pkl")
joblib.dump(real_words, base_dir / "real_words.pkl")

print(f"✅ Saved model files in: {base_dir}")
