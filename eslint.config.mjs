import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** Next 16는 flat config를 기본으로 쓴다 (next lint는 제거됨 → eslint 직접 실행) */
const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "out/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Scene/AI 레이어는 unknown 기반 패치 객체를 다루므로 경고로만 남긴다.
      "@typescript-eslint/no-explicit-any": "warn",
      // localStorage 복원처럼 마운트 시 1회 동기화하는 패턴이 있어 경고로 유지한다.
      // (기능상 정확하며, 렌더 성능 이슈가 확인되면 개별적으로 리팩터링한다)
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
