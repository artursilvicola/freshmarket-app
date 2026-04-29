# Folder src/legacy/

Tu trafia Twój istniejący kod aplikacji `PreconnectFM.jsx` (~470 KB).

## Co zrobić

1. Skopiuj plik **`PreconnectFM (22).jsx`** (lub najnowszą wersję) z folderu, w którym go trzymasz, do tego folderu.
2. Zmień nazwę na **`PreconnectFM.jsx`** (bez nawiasów i numeru wersji).

Końcowo plik powinien być pod ścieżką:
```
src/legacy/PreconnectFM.jsx
```

## Dlaczego ten plik jest "legacy"

To Twoja istniejąca, w pełni funkcjonalna aplikacja w jednym pliku. Trzymamy ją tu jako warstwę wizualną, którą **opakowujemy** autoryzacją Supabase i routingiem ról. Migracja z seed-data (np. `OFFERS_INIT`) na zapytania do bazy (`db.js`) zrobimy stopniowo w kolejnym etapie — bez przepisywania wszystkiego od zera.

## Drobna modyfikacja, którą dorobisz przy migracji

Twój `App()` w PreconnectFM.jsx ma wewnętrzny `AccountSwitcherBar` do przełączania ról. Po wdrożeniu autoryzacji ten przełącznik zastępujesz logiką z props:

```jsx
// Stare:
export default function App() {
  const [account, setAccount] = useState(...);
  // ...
}

// Nowe (przyjmuje props z paneli):
export default function App({ initialRole, currentUser }) {
  const [account, setAccount] = useState({ role: initialRole, ...currentUser });
  // ...
  // Usunąć/ukryć AccountSwitcherBar - rolę narzuca Supabase Auth
}
```

Na pierwszy deploy nie musisz tego robić — aplikacja po prostu pokaże Twój przełącznik ról nad nią. Działa bo wewnątrz pliku jest wszystko.
