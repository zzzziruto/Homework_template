#!/bin/zsh
cd -- "${0:A:h}" || exit 1
print 'DanceTogether · 화면 미리보기'
print '컴퓨터: http://localhost:8785'
print '아이폰 센서는 GitHub Pages의 HTTPS 주소에서 테스트해주세요.'
python3 -m http.server 8785
