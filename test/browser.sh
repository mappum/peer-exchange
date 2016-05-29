#!/bin/sh

if [ $BROWSER ]; then
  zuul \
    --browser-name $BROWSER \
    --browser-version latest \
    --ui tape \
    --tunnel ngrok \
    -- test/browser.js
else
  zuul --local --ui tape -- test/browser.js
fi
