import joblib
from wordfreq import zipf_frequency
from scipy.sparse import hstack
import numpy as np
from pathlib import Path

base_dir = Path(__file__).resolve().parent
model = joblib.load(base_dir / "fakeword_model.pkl")
vectorizer = joblib.load(base_dir / "vectorizer.pkl")
real_words = joblib.load(base_dir / "real_words.pkl")

def clean_word(w):
    return ''.join(ch for ch in w.lower() if ch.isalpha())

def get_features(word_list):
    feats = []
    for w in word_list:
        vowels = sum(c in "aeiou" for c in w)
        freq = zipf_frequency(w, 'en')
        feats.append([len(w), vowels/len(w) if len(w) else 0, freq])
    return np.array(feats)

def detect_fake_words(sentence):
    tokens = [clean_word(w) for w in sentence.split() if clean_word(w)]
    results = []
    for w in tokens:
        freq = zipf_frequency(w, 'en')
        if w in real_words:
            results.append((w, "REAL"))
        elif freq > 4:  # only common words get auto "REAL"
            results.append((w, "REAL"))
        elif freq < 2:  # extremely rare nonsense = FAKE
            results.append((w, "FAKE"))
        else:
            char_vec = vectorizer.transform([w])
            extra = get_features([w])
            final_vec = hstack([char_vec, extra])
            pred = model.predict(final_vec)[0]
            results.append((w, "REAL" if pred == 1 else "FAKE"))

    return results

# Example
sentence = "The quick brown fox jumpped over the blorgy dog meowat rhat is hsi okay"
print(detect_fake_words(sentence))