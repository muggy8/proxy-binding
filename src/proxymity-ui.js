var templateEl = document.createElement("template")
function proxyUI(template, data, propName){
	if (isString(template)){
		templateEl.innerHTML = template.trim()
		var parsedList = templateEl.content.childNodes
		return proxyUI(parsedList, data, propName)
	}

	if (template instanceof NodeList || (isArray(template) && template.reduce(function(current, node){
		return current && node instanceof Node
	}, true))){
		return transformList(arrayFrom(template), data, propName)
	}

	if (template instanceof Node){
		return addOutputApi([transformNode(template, data, propName)], data, propName)
	}
}

function transformList(list, data, propName){
	var withinForeach = false
	var startComment, endComment, repeatBody = []
	var transformableNodes = list.filter(function(item){
		var keepable = true
		if (withinForeach){
			keepable = false
		}
		if (item instanceof Comment && item.textContent.trim().toLowerCase().indexOf("key:") === 0){
			withinForeach = keepable = true
			startComment = item
		}
		if (item instanceof Comment && item.textContent.trim().toLowerCase().indexOf("in:") === 0){
			keepable = true
			withinForeach = false
			endComment = item
		}
		!keepable && repeatBody.push(item)
		return keepable
	})

	console.log(transformableNodes)

	return addOutputApi([])
	return addOutputApi(list.map(function(item){
		return transformNode(item, data, propName)
	}), data, propName)
}

function attachNodeDataProp(node, data, propName){
	Object.defineProperty(node, propName, {
		configurable: true,
		get: function(){
			return data
		},
	})
}

var unlinkSecretCode = generateId(randomInt(32, 48))
function transformNode(node, data, propName){
	var onDestroyCallbacks = []

	attachNodeDataProp(node, data, propName)
	// Object.defineProperty(node, propName, {
	// 	configurable: true,
	// 	get: function(){
	// 		return data
	// 	},
	// })

	onDestroyCallbacks.push(function(){
		delete node[propName]
	})

	if (node instanceof CharacterData){
		var stopSyntaxRender = continiousSyntaxRender(node, node, propName)
		stopSyntaxRender && onDestroyCallbacks.push(stopSyntaxRender)
	}
	else {
		// console.log(node.attributes)
		let attributes = node.attributes
		forEach(arrayFrom(attributes), function(attribute){
			// console.log(attribute)
			var stopSyntaxRender = continiousSyntaxRender(attribute, node, propName)
			stopSyntaxRender && onDestroyCallbacks.push(stopSyntaxRender)
		})
		transformList(arrayFrom(node.childNodes), data, propName)
	}

	onDestroyCallbacks.length && node.addEventListener(unlinkSecretCode, function(ev){
		forEach(onDestroyCallbacks, function(callback){
			callback()
		})

		!(node instanceof CharacterData) && forEach(arrayFrom(node.childNodes), dispatchUnlinkEvent)
	}, {once: true})

	return node
}


// ok here we have all the other support functions that does stuff important but the main 3 is above

// This is the function that adds the additional properties to the output
function addOutputApi(transformedList, data, propName){
	define(transformedList, propName, data)
	define(transformedList, "appendTo", appendTo)
	define(transformedList, "detach", detach)
	define(transformedList, "unlink", unlink)
	return transformedList
}

	// these are the methods that are used by the addOutputApi method to the array object.
	function appendTo(selectorOrElement){
		// if a selector is provided querySelect the element and append to it
		if (isString(selectorOrElement)){
			return appendableArrayProto.appendTo.call(this, document.querySelector(selectorOrElement))
		}

		var target = selectorOrElement
		forEach(this, function(node){
			target.appendChild(node)
		})
		return this
	}

	function detach(){
		forEach(this, function(node){
			var parent = node.parentElement
			parent && parent.removeChild(node)
		})

		return this
	}

	function unlink(){
		forEach(this, dispatchUnlinkEvent)
	}

	function dispatchUnlinkEvent(node){
		var unlinkEvent = new Event(unlinkSecretCode)
		node.dispatchEvent(unlinkEvent)
	}

// this function is responsible for rendering our handlebars and watching the paths that needs to be watched
function continiousSyntaxRender(textSource, node, propName){
	var text = textSource.textContent
	// console.log(text, textSource, node, propName)

	// split the string by "{:" and ":}" and sort them into code segments and text segments
	var clusters = []
	forEach(text.split("{:"), function(chunk, index){
		forEach(chunk.split(":}"), function(subChunk, subIndex){
			clusters.push({
				text: subChunk,
				code: !subIndex && !!index
			})
		})
	})

	// move the watchers into the code that they belong with
	forEach(clusters, function(chunk, index){
		if (chunk.text.length > 2 && chunk.text[0] === "|" && chunk.text[1] === "{"){
			var endWatchSyntax =  chunk.text.indexOf("}|")
			var watchSyntax = chunk.text.slice(1, endWatchSyntax + 1)
			chunk.text = chunk.text.slice(endWatchSyntax + 2)
			clusters[index - 1].watching = watchSyntax.split(",").map(function(str){
				return str.trim().slice(1, -1)
			}).filter(function(item){
				return item
			})
		}
	})

	clusters = clusters.filter(function(chunk){
		return chunk.text || chunk.code
	})

	// render the code that doesn't have watchers
	var onDestroyCallbacks = []
	forEach(clusters, function(chunk){
		if (!chunk.code){
			chunk.val = chunk.text
		}
		else{
			if (!chunk.watching){
				chunk.val = safeEval.call(node, chunk.text)
			}
			else{
				// observer the property that is to be watched
				function updateChunkVal(){
					chunk.val = safeEval.call(node, chunk.text)
					renderString(textSource, clusters)
				}
				forEach(chunk.watching, function(prop){
					// console.log(node[propName], prop)
					onDestroyCallbacks.push(watch(node[propName], prop, updateChunkVal))
				})
				updateChunkVal()
			}
		}
	})

	renderString(textSource, clusters)

	if (onDestroyCallbacks.length){
		return function(){
			forEach(onDestroyCallbacks, function(callback){
				callback()
			})
		}
	}

	// console.log(clusters)
}

function renderString(textSource, clusters){
	var propValue = ""
	forEach(clusters, function(chunk){
		if (chunk.val === undefined){
			return
		}
		propValue += chunk.val
	})

	textSource.textContent = propValue
}
