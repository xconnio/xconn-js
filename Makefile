setup:
	npm install

compile:
	./node_modules/typescript/bin/tsc

clean:
	rm -rf ./node_modules ts-built

test:
	npm run test

check-lint:
	npm run lint

lint:
	npm run lint-fix

build:
	npm run build
