setup:
	npm install

compile:
	./node_modules/typescript/bin/tsc

clean:
	rm -rf ./node_modules ts-built

test:
	./node_modules/.bin/jest ./lib/* ./tests/*

check-lint:
	npm run lint

lint:
	npm run lint-fix

build:
	npm run build
