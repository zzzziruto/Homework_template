#!/bin/zsh
cd -- "${0:A:h}" || exit 1
print 'Dance×Dance · 화면 미리보기'
print '컴퓨터: http://localhost:8785'
print '컴퓨터와 두 모바일의 연결 시연은 모두 아래 공개 주소로 열어주세요.'
print 'https://zzzziruto.github.io/Homework_template/DanceTogether/?v=20261129-layout1'
print '이 터미널을 닫으면 localhost 미리보기도 종료됩니다.'
python3 -m http.server 8785
