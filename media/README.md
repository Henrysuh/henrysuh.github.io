# 🎬 Media Center 기술 스택 & 라이브러리 명세서

GitHub Pages(정적 웹 호스팅) 환경에서 **백엔드 서버 없이 100% 클라이언트 브라우저(Client-side HTML5/JS/Web API)**만으로 구동되는 미디어 도구들의 기술 스택 및 사용 라이브러리 정리입니다.

---

## 📊 도구별 기술 스택 및 라이브러리 요약

| 도구 | 파일 | 사용 라이브러리 / Web API | CDN / 소스 | 주요 역할 및 특징 |
| :--- | :--- | :--- | :--- | :--- |
| **Fuji RAF → JPG 추출기** | `raf_to_jpg.html` | • **바닐라 JS** (`FileReader`, `DataView`)<br>• **JSZip** (v3.10.1) | `cdnjs.cloudflare.com` | • 바이너리 파싱으로 내장 JPEG 0.05초 초고속 추출<br>• 필름 시뮬레이션 원본 색감 100% 보존<br>• 다중 파일 일괄 ZIP 다운로드 |
| **이미지 → SVG 변환기** | `jpg_to_svg.html` | • **ImageTracer.js** (v1.2.6)<br>• **Canvas API**<br>• **바닐라 JS** (Base64) | `cdn.jsdelivr.net` | • 픽셀 분석 기반 벡터 트레이싱 (PPT 도형 분해 가능)<br>• 무손실 원본 임베딩 모드 지원<br>• SVG 코드 즉시 복사 및 다운로드 |
| **포맷 변환 & 리사이저** | `image_converter.html` | • **Canvas API**<br>• **heic2any** (v0.0.4)<br>• **JSZip** (v3.10.1) | `cdn.jsdelivr.net`<br>`cdnjs.cloudflare.com` | • JPG, PNG, WebP 상호 변환 및 용량 압축<br>• 아이폰 HEIC 사진 브라우저 변환<br>• 해상도 리사이징 & 일괄 ZIP 다운로드 |
| **음악 자르기 & MP3 변환기** | `audio_tool.html` | • **Web Audio API** (`AudioContext`)<br>• **lamejs** (v1.2.1)<br>• **Canvas API** | `cdn.jsdelivr.net` | • FLAC, M4A, WAV, MP3 디코딩 및 파형 시각화<br>• 정밀 구간 컷팅 (Loop 재생 지원)<br>• 순수 JS 기반 최고 320kbps MP3 인코딩 |
| **비디오 버퍼 컷 (러프 컷)** | `video_cutter.html` | • **HTML5 Video**<br>• **MediaRecorder API**<br>• **바닐라 JS** | 브라우저 내장 Web API | • 키프레임 여유 버퍼(±3초) 러프 컷팅<br>• **MP4 비디오 클립 기본 생성** (WebM 선택 가능)<br>• 로컬 FFmpeg 1줄 명령어 연계 |

---

## 🔍 도구별 상세 동작 원리

### 1. Fuji RAF → JPG 내장 추출기 (`raf_to_jpg.html`)
- **사용 기술**:
  - `FileReader.readAsArrayBuffer()`
  - `Uint8Array` / `DataView` 바이너리 스캐너
  - `JSZip 3.10.1` (`https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`)
- **작동 원리**:
  1. 후지필름 RAF 파일의 바이너리 구조에서 JPEG 시작 매직 바이트(`0xFF 0xD8 0xFF`)와 끝 매직 바이트(`0xFF 0xD9`)를 탐색합니다.
  2. RAF 파일 내부의 여러 JPEG(썸네일 등) 중 카메라 내부 ISP가 풀사이즈로 렌더링해 둔 **최대 크기 JPEG 스트림**을 슬라이스합니다.
  3. `new Blob([bytes], { type: 'image/jpeg' })`을 생성하여 0.05초 만에 다운로드 링크를 제공합니다.
- **장점**: LibRaw/rawpy의 디모자이크 오류나 필름 시뮬레이션 색감 손실 없이, **카메라에서 보던 색감 그대로** 즉시 추출됩니다.

---

### 2. 이미지 → SVG 변환기 (`jpg_to_svg.html`)
- **사용 기술**:
  - `ImageTracer.js 1.2.6` (`https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js`)
  - `HTML5 Canvas 2D Context` (`getImageData`)
- **2가지 변환 옵션 상세 비교**:

| 비교 항목 | 옵션 1: 벡터 트레이싱 (Vector Tracing) | 옵션 2: 임베딩 (Base64 Embedding) |
| :--- | :--- | :--- |
| **변환 원리** | 픽셀 색상 영역을 분석해 **수학적 곡선(Path 도형)**으로 재구성 | SVG 태그 안에 원본 이미지를 **Base64 코드로 통째로 삽입** |
| **결과물 성격** | **진짜 벡터(Vector)** — 무한 확대해도 깨짐 없음 | **래스터(Raster)** — 확대 시 픽셀 깨짐 유지 |
| **파워포인트(PPT) 편집** | **도형으로 변환 후 개별 패스 색상·모양 수정 가능** | 그냥 '그림'으로 취급되어 도형 분해 불가 |
| **사진 재현도** | 색상이 단순화되어 **일러스트/포스터풍**으로 변환 | **원본 100% 동일** (화질/색감 손실 0%) |
| **추천 용도** | **로고, 아이콘, 다이어그램, 일러스트, 폰트** | **마크다운(Obsidian/Typora) 단일 파일 내장, 단순 SVG 포맷 래핑** |
| **세부 조절 옵션** | • 색상 수 (2~64개)<br>• 블러/스무딩 강도 (0~5)<br>• 프리셋 (표준, 일러스트, 상세, 흑백) | 설정 불필요 (100% 자동 즉시 변환) |

---

### 3. 이미지 포맷 변환 & 리사이저 (`image_converter.html`)
- **사용 기술**:
  - `heic2any 0.0.4` (`https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js`)
  - `HTML5 Canvas API` (`toBlob(callback, type, quality)`)
  - `JSZip 3.10.1`
- **작동 원리**:
  1. 아이폰 HEIC 파일이 들어오면 `heic2any` 라이브러리가 Web Worker 기반으로 JPEG Blob으로 사전 변환합니다.
  2. Canvas에 로드한 후 비율을 유지하며 지정된 해상도(75%, 50%, FHD 등)로 다운샘플링합니다.
  3. 브라우저 내장 인코더를 통해 JPG, PNG, WebP 포맷과 지정된 품질(Quality)로 즉시 압축 변환합니다.

---

### 4. 음악 자르기 & MP3 변환기 (`audio_tool.html`)
- **사용 기술**:
  - `Web Audio API` (`AudioContext`, `AudioBuffer`, `AudioBufferSourceNode`)
  - `lamejs 1.2.1` (`https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js`)
  - `HTML5 Canvas API` (파형 실시간 렌더링)
- **작동 원리**:
  1. 브라우저 내장 하드웨어 가속 코덱(`AudioContext.decodeAudioData()`)이 FLAC, M4A, WAV, MP3 음원을 PCM Float32 버퍼로 디코딩합니다.
  2. 디코딩된 PCM 신호의 진폭을 분석하여 Canvas 위에 시각적 파형(Waveform)을 렌더링합니다.
  3. 지정된 시작점~종료점 구간의 오디오 버퍼를 슬라이스한 후, `lamejs`의 `Mp3Encoder`에 1152 샘플 청크 단위로 넘겨 128~320kbps MP3 바이너리를 생성합니다.
- **장점**: 수십 MB가 넘는 무거운 WASM 없이 **가벼운 순수 JavaScript**로 구동되어 빠른 로딩과 안정적인 변환 속도를 제공합니다.

---

### 5. 비디오 버퍼 컷 (러프 컷팅) (`video_cutter.html`)
- **사용 기술**:
  - `HTML5 Video API` (`video.captureStream`)
  - `MediaRecorder API` (`video/mp4;codecs=avc1`, `video/webm`)
- **작동 원리**:
  1. 브라우저에서 동영상을 로드하고 시작/종료 시간에 키프레임 여유 버퍼(±3초)를 설정합니다.
  2. 비디오 엘리먼트의 재생 스트림을 `MediaRecorder`로 캡처하여 **MP4(`.mp4`) 클립**을 브라우저 로컬에서 즉시 녹화 및 생성합니다 (WebM도 선택 가능).
  3. 수 GB 이상의 대용량 파일이나 무손실 스트림 복사가 필요한 경우 바로 복사해 쓸 수 있는 **FFmpeg 1줄 명령어**와 오픈소스 **LosslessCut** 가이드를 제공합니다.

---

## 🔒 보안 및 개인정보 보호 (Privacy & Security)

모든 도구는 **100% 클라이언트 사이드(Client-side)** 환경에서 동작합니다:
- 업로드된 사진, RAW 파일, 오디오, 비디오 파일은 **외부 서버로 단 1바이트도 전송되지 않습니다.**
- 모든 변환 및 데이터 처리는 **사용자의 웹 브라우저 메모리(RAM) 내부에서만 수행**되며, 탭을 닫으면 즉시 소멸합니다.
