파일이 늘어날 때 아래 구조로 정리

```
henrysuh.github.io/
│
├── index.html              ← 홈페이지
│
├── map.html                ← 차박지도
├── data1/                   ← CSV 데이터 폴더
│   ├── jeju_oreum.csv
│   ├── forest.csv
│   ├── rest_area.csv
│   └── market.csv
│
├── project2.html           ← 두 번째 프로젝트
├── data2/                  ← 두 번째 프로젝트 데이터
│
└── assets/                 ← 공통 리소스
    ├── favicon.ico
    └── og-image.png        ← 카카오/SNS 공유 시 썸네일
```

**폴더 이동 시 주의사항:**

`data/` 폴더로 CSV를 옮기면 `map.html`의 CSV 경로도 수정 필요

```javascript
// 변경 전
'jeju_oreum.csv'

// 변경 후
'data/jeju_oreum.csv'
```

**기준점:** 파일이 10개 이상 루트에 쌓이기 시작할 때 정리