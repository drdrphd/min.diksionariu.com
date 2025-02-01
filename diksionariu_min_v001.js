/*!
 * min.diksionariu.com
 * Version: 0.0.1 (fork of diksionariu.com v.40.a)
 * Author: dr²
 * AI: ChatGPT (proofreading, architecture suggestions)
 * License: fully open, no rights reserved, use at your own risk
 * Description: A JavaScript module to plug into webpages
 * 				to interface with the diksionariu.com database
 *				https://diksionariu.com
 *				(CHamoru-English dicionary, expanded from the
 *				Guam Department of CHamoru Affairs Dictionary
 *				overseen by Katherine Aguon, lead editor)
 *
 * Contents:
 *		Constructor
 *			Includes references to HTML fields and formatting templates
 *		Functions - Initialize Search
 *			search(str)
 *		Functions - Searching Tools
 *			fuzzySearch(string) -- performs a fuzzy search via extractAllWords() and levenshtein(...)
 * 			extractAllWords(JSON_array) -- takes returned SQL results and sifts out: entries, and anything in [[..]]
 *			levenshtein(string, string) -- returns a modified Levenshtein distance between 2 strings
 *		Functions - Formatting 
 *			replaceMarkup(string) -- replace ''' (bold) and ~~ (italics) and [[...]] (links) with html tags
 *				this must be done before highlighting is added, otherwise it may interere with links
 *			addHighlights(string, string) -- helper function, highlight a substring, adds HTML tags
 *			formatSingleResult(array) -- helper function to format a complete entry
 *		Functions - Process Results
 *			displayCHResults(str, JSON_array, (str)) -- deals with the returned values in a single-entry view
 *			displayCHAltResults(str, JSON_array) -- deals with returned results when main entry not found,
 *				but found in 'alternate_forms', 'related_forms', or 'see_also' (formatted like displayEngResults)
 *			displayCHPartialResults(str, JSON_array) -- no entry, but matches part of other entry
 *			displayEngResults(str, JSON_array) -- deals with the returned English results
 *			displayError(str) -- displays errors in PHP fetching
 */


/*****************/
/** Constructor **/
/*****************/

function diksionariu() {
	
	var self = this; //for access in functions
	
	const PHP_ref = "diksionariu_min.php";
	this.PHP_ref = PHP_ref;
	
	this.search_field = document.getElementById("diksionariu-search");
	this.results_div = document.getElementById("diksionariu-results");
	this.search_bar = document.getElementById("diksionariu-entry");
	this.submit_button_CH = document.getElementById("diksionariu-submit-button-CH");
	this.submit_button_Eng = document.getElementById("diksionariu-submit-button-Eng");
	
	//initialize listeners
	this.search_bar.addEventListener("keyup", function(event) {
		if (event.key === "Enter")  self.search(self.search_bar.value);
	});
	this.submit_button_CH.addEventListener("click", function() {
		self.search(self.search_bar.value);
	});
	this.submit_button_Eng.addEventListener("click", function() {
		self.search(self.search_bar.value, "Eng");
	});
	this.results_div.addEventListener('click', (event) => {
        if (event.target.tagName === 'A' && event.target.dataset.query) {
            event.preventDefault();
			self.search_bar.value = event.target.dataset.query;
            self.search(event.target.dataset.query);
        }
    });
	
	
	/// Templates
	///	Methods:
	///			swap(Object) -- takes the extracted text from within a template {{...}}
	///							redirects to a template, returns formatted HTML
	///
	///	Templates:
	///
	///			(General format) -- {{name_of_template||...||...||...}}
	///
	///			Line break -- {{}}		<-- empty template
	///			Bulleted examples -- {{||example_CH|example_EN||...}}	<-- empty template name (SQL searches over the 'examples' field; 
	///																			possible interactions with words here (searching 'ex'
	///																			would return all examples rather than examples with 'ex' in them))
	///			Bulleted list -- {{list||word|meaning||...}}
	///					in the future, hopefully -- {{ex||example_CH|example_EN|morph|source||...}}
	///			Selected Affixed forms -- {{sel_aff||aff|word|meaning|example_CH|example_EN||...}
	
	const templates = {

		// swap(Object)
		//
		// Takes: inner text extracted from a template {{...}}
		//
		// Method:  extracts the template name (if any)
		//			parses the text from ||...|...|...||...|...|...
		//			into [[...,...,...],[...,...,...],...]
		//			accesses templates (below)
		//			forwards results
		//
		// Returns: formatted HTML
		//
		swap: function(template_text) {
			//check for {{}} first (empty template)
			if (template_text.length == 0) return this.templates.lineBreak();

			//otherwise, turn text into array, and then split those into sub-arrays
			//TODO -- probably some form of validation or checking here!!!
			template_text = template_text.replaceAll("||","§");
			var template_array = template_text.split("§"); //parse text into an array and store here
			var template_name = template_array.shift(); //pop-off first element as template name

			//check for {{||.... (exmpty template name)
			if (template_name.length == 0) template_name = "examples";
			
			//split array into sub-arrays by |
			for (var i = 0; i < template_array.length; i++) {
				template_array[i] = template_array[i].replaceAll("|","§");
				template_array[i] = template_array[i].split("§");
			}
			
			//check for template, throw error if DNE
			if (this[template_name]) {
				return this[template_name](template_array);
			} else {
				throw new Error('Template not found: ' + template_name);
			}
		},


		//
		// Templates
		//

		//Bulleted list
		lineBreak: function() {
			return "<br />";
		},
		
		//Bulleted list
		list: function(arr) {
			//TODO - error checking
			var t = "";
			for (var i = 0; i < arr.length; i++) {
				t += "<li>" + arr[i][0];
				if (arr[i].length > 1) t += " (" + arr[i][1] + ")";
				t += "</li>";
			}
			return t;
		},
		
		//Bulleted examples
		examples: function(arr) {
			//TODO - error checking
			var t = "";
			for (var i = 0; i < arr.length; i++) {
				t += "<div class='ex-ch'>" + arr[i][0] + "</div>";
				if (arr[i].length > 1) t += "<div class='ex-eng'>" + arr[i][1] + "</div>";
			}
			return t;
		}
	};
	
	this.templates = templates;
}



/**************************************/
/** Functions -- Initializing Search **/
/**************************************/
//
// Search
//
// Takes: a query (str) & language_code (str)
//
// Method: Do not accept empty queries
//		   Trim leading and trailing whitespace
// 		   Send to PHP (where it will be sanitized)
//
diksionariu.prototype.search = function(str, lang="CH") {
	const self = this;	//reference the diksionariu object from the XMLHttpRequest
	
	str = str.trim();  //remove leading and trailing whitespace
	if (str.length < 1) return;		//blank search field, do not search
	str = "q="  + encodeURIComponent(str) + "&lx=" + lang;	//prepare for SQL query
	
	if (window.XMLHttpRequest)  xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			const response 		= JSON.parse(this.responseText);
            const function_name	= response.function_name;
			const query 		= response.query;
            const data 			= response.data;
			const param1		= response.param1;
			const param2		= response.param2;
			
			//try to make dynamic function call (or display error)
			if (typeof self[function_name] === "function") {
				if (typeof param1 === 'undefined' && typeof param2 === 'undefined') {
					self[function_name](query,data);
				}
				if (typeof param1 !== 'undefined' && typeof param2 === 'undefined') {
					self[function_name](query,data,param1);
				}
				if (typeof param1 !== 'undefined' && typeof param2 !== 'undefined') {
					self[function_name](query,data,param1,param2);
				}
            } else {
                this.displayError("Error: Function [" + function_name + "] is not defined.");
            }
		}
	};			
	xmlhttp.open("GET",this.PHP_ref + "?" + str,true);
	xmlhttp.setRequestHeader("Content-Type", "application/json; charset=utf-8");
	xmlhttp.send();
}


/**********************************/
/** Functions -- Searching Tools **/
/**********************************/

//
// Fuzzy search
//
// fuzzySearch(string, JSON_array)
//
// Takes: search string, array of all entries and words from links [[..]]
// Returns: (string) a formatted list of close matches
// 			with links for new searches
//			and match strength bars
//
diksionariu.prototype.fuzzySearch = function(str, all_words, long_list=false) {
	
	var results = [];
	var results_list = "";
	var word_list = this.extractAllWords(all_words);
	var list_length = (long_list ? 20 : 10);	//list length at 20 or 10 items (20 for direct fuzzy search ~)

	str = str.replaceAll("~","");		//strip out encoded ~ if included in search (fuzzy search shortcut wildcard)
	
	for (var i = 0; i < word_list.length; i++)
		if ( Math.abs(str.length - word_list[i].length) < 4)	//only look at words similar in length
			results.push( [this.levenshtein(word_list[i],str) , word_list[i]] );
	
	//sort descending by Levenstein ratio
	results.sort(function(a,b) {return a[0] > b[0] ? -1 : 1;} );
	
	for (var i = 0; i < Math.min(results.length, list_length); i++) {
		results_list +=
			"<div class='fuzzy-match'>"
				+ "<div class='match-strength'><div class='match-strength-bar' style='width:" + (5 * results[i][0]) + "em'></div></div>"
				+ "<a href='#' data-query=\"" + results[i][1] + "\">" + results[i][1] + "</a>"
				+ "<br />"
			+ "</div>";
	}
	
	if (long_list) {
		results_list = "<div class='fuzzy-container fuzzy-container-columns'>" + results_list + "</div>";
	} else {
		results_list = "<div class='fuzzy-container'>" + results_list + "</div>";
	}
	return (results_list);
}

//
// Extract all words
//
// extractAllWords(JSON_array)
// 
// From result containing all of:
//	'entry','alternate_forms','related_forms','see_also'
// Take all entries, and extract text from links [[..]] in other fields
//
// Return: vector of strings
//
diksionariu.prototype.extractAllWords = function(a) {
	var list = [];
	for (var i=0; i < a.length; i++) {
		list.push(a[i]["entry"]);
		for (var k of ["alternate_forms","related_forms","see_also"]) {
			var temp = a[i][k].match(/(\[\[[^\[]*\]\])/g) || [];
			for (var j=0; j < temp.length; j++) {
				temp[j] = temp[j].slice(2,temp[j].indexOf("|"));
				list.push(temp[j].replace("]",""));
			}
		}
	}
	return Array.from(new Set(list)).sort();
}

//
// Levenshtein ratio (distance / length) (for CHamoru)
// Code adapted from: http://glench.github.io/fuzzyset.js/
//
// Helper function for fuzzySearch
// Calculates similarity between two strings,
// taking into account common spelling errors in CHamoru
//
// Takes: two strings
// Returns: a value on [0,1]
//			(1 - (scaling factor)*(Levenshtein distance / longer length))
//
diksionariu.prototype.levenshtein = function(str1, str2) {
	var current = [], prev, value;
	
	//ignore glotta, replace 'ñ' with 'n', and reduce geminate consonants
	str1 = str1.replaceAll("'","").replaceAll("ñ","n").replace(/([BCDFGHKLMNPRSTYbcdfghklmnprsty])\1+/g, '$1').toLowerCase();
	str2 = str2.replaceAll("'","").replaceAll("ñ","n").replace(/([BCDFGHKLMNPRSTYbcdfghklmnprsty])\1+/g, '$1').toLowerCase();
	
	//method
	for (var i = 0; i <= str2.length; i++)
		for (var j = 0; j <= str1.length; j++) {
		if (i && j){
			var a = str1.charAt(i - 1);
			var b = str2.charAt(j - 1);
			var ab = [a,b];
			//same
			if (a === b) value = prev;
			//common CHamoru substitutions
			else if (ab.includes("a") && ab.includes("å")) value = prev + 0.1;
			else if (ab.includes("i") && ab.includes("e")) value = prev + 0.5;
			else if (ab.includes("i") && ab.includes("u")) value = prev + 0.5;
			else if (ab.includes("u") && ab.includes("o")) value = prev + 0.5;
			else if (ab.includes("e") && ab.includes("o")) value = prev + 0.5;
			else if (ab.includes("a") && ab.includes("e")) value = prev + 0.8;
			else if (ab.includes("a") && ab.includes("o")) value = prev + 0.8;
			else if (ab.includes("å") && ab.includes("o")) value = prev + 0.8;
			else if (ab.includes("l") && ab.includes("r")) value = prev + 0.8;
			else if (ab.includes("l") && ab.includes("t")) value = prev + 0.8;
			else if (ab.includes("r") && ab.includes("t")) value = prev + 0.8;
			else value = Math.min(current[j], current[j - 1], prev) + 1;	//deletion, substitution, insertion
		}
		else
			value = i + j;

		prev = current[j];
		current[j] = value;
		}
	
	//Levenshtein distance is a positive number (number of changes)
	//Here we take a ratio (1 / longer word)
	//But to make bigger better, take 1 - ratio
	//Small words with 1 change will look far worse than large words with 1 change, so scale by length (1  -  1/(.5 + length))
	return (1.0 - (1 - (1 / (.5 + Math.max(str1.length,str2.length)))) * (current.pop() / Math.max(str1.length,str2.length)));
}




/*****************************/
/** Functions -- Formatting **/
/*****************************/

//
// replaceMarkup(string)
//
// helper function --
// Looks for '''...''' and ~~...~~ and [[...]] or [[...|...]]
//  replaces them with <b>...</b> and <i>...</i> and <a>...</a> tags
// Also looks for templates {{...|...|...(...)}}
//  and swaps out with a query to the appropriate template
//
// *Must be done before adding highlighting (or may mess up links)
//
// returns a string (with html tags)
//
diksionariu.prototype.replaceMarkup = function(str) {
	const self = this; //for accessing prototype from within functions
	
	//swap out '''...''' for §, and then § for <b>...</b> tags
	str = str.replaceAll("''''","'§");	//for words that end in glotta -- will otherwise give §'
	str = str.replaceAll("'''","§");
	str = str.replace(/(§[^§]*§)/g,	//regex:  § [anything that's not §] §
		function(match) {
			return "<b>" + match.slice(1, -1) + "</b>";	//regex includes the starting and ending markup, so slice those out
		}
	);
	
	//swap out ~~...~~ for §, and then § for <i>...</i> tags
	str = str.replaceAll("~~","§");
	str = str.replace(/(§[^§]*§)/g,	//regex:  § [anything that's not §] §
		function(match) {
			return "<i>" + match.slice(1, -1) + "</i>";	//regex includes the starting and ending markup, so slice those out
		}
	);
	
	//swap out [[...]] for <a> ... </a> tags
	str = str.replace(/(\[\[[^\[]*\]\])/g,	//regex:  [[ + (anything that's not '[') + ]]
		function(match) {
		    if (match.includes('|')) {
		        var links = match.split('|');
				var probableURL = /[A-Za-z0-9]\.[A-Za-z0-9]{2}/;	//regex for likely URLs, which will probably have X.XX somewhere in them
				if (probableURL.test(links[1])) { //if (likely) external, do not use encodeURIComponent
					return "<a class='markup-link external' target='_blank' href=\"" + links[1].slice(0,-2) + "\">" + links[0].slice(2) + "</a>";	//regex includes the starting and ending markup, so slice those out
				} else {
					return "<a class='markup-link' href='#' data-query=\"" + links[1].slice(0,-2) + "\">" + links[0].slice(2) + "</a>";	//regex includes the starting and ending markup, so slice those out
				}
		    } else {
		        return "<a class='markup-link' href='#' data-query=\"" + match.slice(2, -2) + "\">" + match.slice(2, -2) + "</a>";	//regex includes the starting and ending markup, so slice those out
		    }
		}
	);
	
	//swap out {{...}} for template
	//(TODO - Eventually this should handle recursion -- templates in templates (see Wiktionary) )
	str = str.replace(/(\{\{[^\{]*\}\})/g,	//regex:  {{ + (anything that's not '{') + }}
		function(match) {
		    try {
				return self.templates.swap(match.slice(2,-2));
			} catch (e) {
				console.error(e.message);
			}
		}
	);
	
	return str;
}


//
// addHighlights(string, string)
//
// Used when returning English and Advanced search
//  results to help show the search string
//
// helper function --
// Takes a results string and substring to highlight
// Adds html tag highlighting around the substring
//
// *Markup must be replaced before adding highlighting (to avoid link errors)
// Strings will already include HTML tags
//
// returns a string (with html tags)
//
diksionariu.prototype.addHighlights = function(str, substr) {
	
	//write a longer method later -- but for the moment if substring contains * ? ~, just return unaltered string
	if (substr.includes("*") || substr.includes("?") || substr.includes("~") ) return str;
	
	
	//This is a dicey approach -- RegEx is not a great tool for finding HTML tags
	//find HTML tags
	var regex = /<[^\<]*>/g;	//find:  < and whatever in between that doesn't have another < before a closing >
	//return an array of their positions and lengths in str
	var markup = [...str.matchAll(regex)];
	
	//get unmarked string and unmarked substring
	var temp = document.createElement("div");
	temp.innerHTML = str;
	temp = temp.innerText.normalize("NFD").replace(/[\u0300-\u036f]/g, "");  //deaccent string to avoid diaritic errors
	substr = substr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");  //deaccent string to avoid diaritic errors
	
	//search in the unmarked string for the search term (substring indices)
	var substring_indices = [...temp.toLowerCase().matchAll(new RegExp(substr.toLowerCase(), 'gi'))].map(a => [a.index, a.index + a[0].length]);
	
	//adjust the substring indices to account for trimmed markup
	for (var i = 0; i < markup.length; i++) {
		for (var j = 0; j < substring_indices.length; j++) {
			if (markup[i].index <= substring_indices[j][0]) {
				substring_indices[j][0] += markup[i][0].length;
			}
			if (markup[i].index <= substring_indices[j][1]) {
				substring_indices[j][1] += markup[i][0].length;
			}
		}
	}
	
	//insert the highlight tags at the new substring indices,
	//working from the end of the string to the beginning
	for (var i = substring_indices.length - 1; i > -1; i--) {
		str = str.substring(0,substring_indices[i][1]) 			//first part of the string un-highlighted
				+ "</span>"											//closing tag
				+ str.substring(substring_indices[i][1], str.length);   //rest of the string
				
		str = str.substring(0,substring_indices[i][0]) 			//first part of the string un-highlighted
				+ "<span class='highlight'>"	   					//opening tag
				+ str.substring(substring_indices[i][0], str.length);   //rest of the string
	}
	return str;
}


//
// formatSingleResult(array, (boolean))
//
// helper function --
// Formats a single result vector for display
//
// optional boolean parameter for Word of the Day
//   (no header: Entry word formatted separately
// 				 No Link to browse in context)
// 
// returns a string (with html tags)
//
diksionariu.prototype.formatSingleResult = function(res, header=true) {
	
	var show_alternate_forms = "",
		show_origin = "",
		show_pos = "",
		show_definition = "",
		show_examples = "",
		show_notes = "",
		show_related_forms = "",
		show_see_also = "",
		show_source = "";
	var show_minor_content = "";	//for spacer formatting
	
	//example formatting - if not a template, add <li> formatting
	if(res.examples.length > 0 && res.examples.slice(0,2) != "{{") res.examples = "<ul><li><i>" + res.examples + "</i></li></ul>";
	
	if(res.alternate_forms.length > 0)	{show_alternate_forms 	= "<h3>Alternate Forms:</h3>" 	+ "<div class='entry-field'>" + res.alternate_forms + "</div>";}
	if(res.origin.length > 0)			{show_origin 			= "<h3>Origin:</h3>" 			+ "<div class='entry-field'>" + res.origin + "</div>";}
	if(res.part_of_speech.length > 0)	{show_pos 				= "<h3 class='part-of-speech'>" + res.part_of_speech + "</h3>";}
	if(res.definition.length > 0)		{show_definition 		= 	"<div class='entry-field'>" + res.definition + "</div>";}
	if(res.examples.length > 0)			{show_examples 			= 	"<div class='entry-field'>" + res.examples 	+ "</div>";}
	if(res.notes.length > 0)			{show_notes 			= "<h3>Notes:</h3>" 			+ "<div class='entry-field'>" + res.notes + "</div>";}
	if(res.related_forms.length > 0)	{show_related_forms 	= "<h3>Related Forms:</h3>" 	+ "<div class='entry-field'>" + res.related_forms + "</div>";}
	if(res.see_also.length > 0)			{show_see_also 			= "<h3>See Also:</h3>" 			+ "<div class='entry-field'>" + res.see_also + "</div>";}
	if(res.source.length > 0)			{show_source 			= "<h3>Source:</h3>" 			+ "<div class='entry-field'>" + res.source + "</div>";}
	
	
	if(show_alternate_forms.length > 0 || show_origin.length > 0 || show_notes.length > 0 || show_related_forms.length > 0 || show_see_also.length > 0 || show_source.length > 0) {
		show_minor_content = 
			"<div class='content minor-content'>" +
				show_alternate_forms +
				show_origin +
				show_notes +
				show_related_forms +
				show_see_also +
				show_source +
			"</div>";
	}
	
	//assemble the entry
	var formatted_result = "";
	if (header) {
		formatted_result += 
		"<div class='entry'>" +
			"<h1>" + res.entry + "</h1>";
	}
	formatted_result +=
			"<div class='content'>" +
				show_pos +
				  show_definition +
					show_examples +
			"</div>" +
			show_minor_content +
		"</br></div>";
		
	//swap out markup for html tags
	formatted_result = this.replaceMarkup(formatted_result);
		
	return formatted_result;
}





/**********************************/
/** Functions -- Process Results **/
/**********************************/

//
// Display CHamoru Results
//
// displayCHResults(str, JSON_array, (str), (JSON_array))
//		first str = the search query
//		first JSON_array = search results
//		second str = optional initial message passed from other functions (like redirect messages)
//		second JSON_array = array of 'entry','alternate_forms','related_forms','see_also' for fuzzy search
//
// Show the retrieved results with a button for multiple-entry-view
// If no results - show No Results
// If there are wildcards, show how many results were found and then show the results
// Otheriwse, show results, starting with exact matches
//
diksionariu.prototype.displayCHResults = function(str, results, message = "", all_words = []) {
	
	var formatted_results = "" + message;

	//We will be re-sorting the results
	//Exact results first
	var temp_exact = [];
	var temp_partial = [];
	
	
	//If SQL returns "0" (entry not found)
	if (results == "0") {
		
		//Run fuzzy search if no message
		if (message == "") {
			formatted_results = 
				"<h2>" + str + "</h2>" + 
				"<p class='no-result'>Entry not found</p></br>" +
				"<h3>Did you mean: </h3>" + this.fuzzySearch(str, all_words);
		
		//For Direct fuzzy search (returns "0" and a message)
		} else if (message.length > 0) {
			formatted_results += this.fuzzySearch(str, all_words, true);
		}
	}
	
	//Results found, but Compound or Wildcard Searches
	if (results != "0") {
		
		//Check for wildcard searches
		if (str.indexOf("*") > -1 || str.indexOf("?") > -1) {
			
			//display results starting with total number of hits found...
			formatted_results = "<div><h2>" + results.length + " results found</h2></div>";
			
			//build HTML and attach to results
			for (var i = 0; i < results.length; i++) {
				formatted_results += this.formatSingleResult(results[i]);
			}
		
		//Non-wildcard, display results, starting with exact matches to search string
		} else {
						
			//re-order by exact matches to search string
			for (var i = 0; i < results.length; i++) {
				if (results[i].entry == str) {
					temp_exact.push(i);
				} else {
					temp_partial.push(i);
				}
			}

			//build HTML for each entry and attach to the results section
			//display exact matches first
			for (var j = 0; j < temp_exact.length; j++) {
				var i = temp_exact[j];
				formatted_results += this.formatSingleResult(results[i]);
			}
			//and partial matches next
			for (var j = 0; j < temp_partial.length; j++) {
				var i = temp_partial[j];
				formatted_results += this.formatSingleResult(results[i]);
			}
		}
	}
	
	//display the formatted results in the 'results' section
	formatted_results = "<div class='results-single'>" + formatted_results + "</div>";
	this.results_div.innerHTML = formatted_results;
}


//
// Display Alternate CHamoru Results
// (When search query doesn't find a main entry, but finds it in 'alternate_forms', 'related_forms', or 'see_also')
// 
// Takes an object of results from the SQL query
// and does some organizing -- display is like displayEngResults
// *Includes highlighting
//
diksionariu.prototype.displayCHAltResults = function(str, results) {
	
	//We will be re-sorting the results
	//Exact results first
	var temp_alternate = [];
	var temp_related = [];
	var temp_also = [];

	//if the results contain only one entry where
	//"alternate forms" contains the search term
	//redirect to that entry
	//****Probably replace this later with a PHP version******
	var alt_hits = 0;	//how many alternate_forms contain the search str?
	var last_i = 0;		//track index of results that have alt_form so we don't have to run thru again
	for (var i = 0; i < results.length; i++) {
		if (results[i].alternate_forms.includes("[[" + str + "]]")) {
			alt_hits++;
			last_i = i;
		}
	}
	if (alt_hits == 1) {
		var message = "<div class='entry-field redirect-text'>(Redirected from <a href='#' data-query='" + str + "'>" + str + ")</a></div>";
		this.displayCHResults(results[last_i].entry, [results[last_i]], message);
		return;
	}

	//Check for wildcard searches
	//If there are no wildcards, reorder the entries, starting with Alternate Forms,
	//then Related Forms and See Also
	//
	//if no wildcards
	if (!(str.indexOf("*") > -1 || str.indexOf("?") > -1)) {
		//reorder entries...
		for (var i = 0; i < results.length; i++) {
			if (results[i].alternate_forms.includes(str)) {
				temp_alternate.push(results[i]);
			} else if (results[i].related_forms.includes(str)) {
				temp_related.push(results[i]);
			} else {
				temp_also.push(results[i]);
			}
		}
		//and reassemble into results
		results = temp_alternate.concat(temp_related, temp_also);
	}
	
	
	//Add "not found" message and offer Fuzzy Search link
	var formatted_results = "<h2>" + str + "</h2>" +
			"<p class='no-result'>Entry not found</p>" +
			"<p class='no-result'><a class='no-result-link' href='#' data-query=\""
				+ str + "~" + "\">Try fuzzy search? " + str + "~</a><br /><br /></p>";
	
	
	//display results starting with total number of hits found...
	formatted_results += "<div><h3>" + results.length + " results in other entries</h3></div>";
	
	//handle markup: remove ''' ... ''' (leave ~~italics~~ and [[links]])	<- [[.|.]] links are problematic
	//(for alternate results, we just trim it out)
	for (var i = 0; i < results.length; i++) {
		results[i].alternate_forms 	= this.replaceMarkup(results[i].alternate_forms	.replaceAll("'''",""));
		results[i].related_forms 	= this.replaceMarkup(results[i].related_forms	.replaceAll("'''",""));
		results[i].see_also			= this.replaceMarkup(results[i].see_also		.replaceAll("'''",""));
		results[i].definition 		= this.replaceMarkup(results[i].definition);
	}
	
	//highlight the search terms in the results
	for (var i = 0; i < results.length; i++) {
		results[i].alternate_forms = this.addHighlights(results[i].alternate_forms, str);
		results[i].related_forms   = this.addHighlights(results[i].related_forms,   str);
		results[i].see_also		   = this.addHighlights(results[i].see_also,		str);
	}
	
	for (var i = 0; i < results.length; i++) {
		
		var show_alternate_forms = "",
			show_related_forms = "",
			show_see_also = "";
		
		if (results[i].alternate_forms.length > 0)	{show_alternate_forms = "<p><b>Alternate Forms: </b>" + results[i].alternate_forms + "</p>";}
		if (results[i].related_forms.length > 0)	{show_related_forms   = "<p><b>Related Forms: </b>"   + results[i].related_forms   + "</p>";}
		if (results[i].see_also.length > 0)			{show_see_also		  = "<p><b>See Also: </b>"		  + results[i].see_also		   + "</p>";}

		formatted_results += 
			"<div class='results-english'>" +
				"<h3><a href='#' data-query=\"" + results[i].entry + "\">" + results[i].entry + "</a></h3>" +
				"<p><b>Part of Speech:</b> " + results[i].part_of_speech + "</p>" +
				"<p><b>Definition:</b> " + results[i].definition + "</p>" +
				show_alternate_forms +
				show_related_forms +
				show_see_also +
			"</div>";
	}
	
	//insert into document
	this.results_div.innerHTML = "<div class='results-single'>" + formatted_results + "</div>";
}


//
// Display CHamoru Partial Matches
// (No entry, but query matches part of an entry)
// 
// Takes an object of results from the SQL query
// and does some organizing -- display is like displayCHAltResults
// *Includes highlighting
//
diksionariu.prototype.displayCHPartialResults = function(str, results, all_words) {
	
	var formatted_results =
		"<h2>" + str + "</h2>" +
		"<p class='no-result'>Entry not found</p>";
	
	//display results starting with total number of hits found...
	formatted_results +=
		"<div class='partial-container'>"
			+ "<div class='partial-subcontainer'>"
				+ "<h3>Partial matches</h3>"
				+ "<div class='partial-results'>";
	
	//sort results by length similarity to search string
	results.sort((a,b) => Math.abs(a.entry.length - str.length) - Math.abs(b.entry.length - str.length));
	
	//form links and highlight the search terms
	for (var i = 0; i < Math.min(results.length, 10); i++) {
		var highlighted = "";
		if (results[i].entry.length > str.length) {
			highlighted = this.addHighlights(results[i].entry, str);
		} else { 
			highlighted = results[i].entry;
		}
		
		formatted_results += 
			"<div class='partial-match'>"
				+ "• <a href='#' data-query=\"" + results[i].entry + "\">"
				+ highlighted
			+ "</a></div>";
	}
	
	if (results.length > 10) {
		formatted_results +=
			"<div class='partial-match'>"
				+ "<a href='#' data-query=\"" + "*" + str + "*" + "\">" + "See more..." + "</a>"
			+ "</div>";
	}
	
	formatted_results += "</div></div><div class='partial-subcontainer'><h3>Or did you mean: </h3>" + this.fuzzySearch(str, all_words) + "</div></div>";
	
	//insert into document
	this.results_div.innerHTML = "<div class='results-single'>" + formatted_results + "</div>";
}



//
// Display English Results
//
// Takes an object of results from the SQL query
// and does some organizing -- move results that contain the query as a whole word/term first
// *Includes highlighting
//
diksionariu.prototype.displayEngResults = function(str, results) {
	
	var formatted_results = "";
	
	//We will be re-sorting the objects (which are returned in order of length of definition, shortest first)
	//We want any definitions that include the isolated search string to come up first
	//Thus, for 'fun':  " fun ", ##"fun ", " fun"##, " fun,", " fun.", etc.
	var temp_exact = [];
	var temp_partial = [];
	
	//SQL returns a "0" if search finds nothing
	if (results == "0") {
		this.results_div.innerHTML = 
			"<h2>" + str + "</h2>" +
			"<p class='no-result'>No results found</p>" + 
			"<p class='no-result'><a class='no-result-link' href='#' data-query=\""
				+ str + "\">Repeat search in CHamoru?</a></p>";

	} else {
		
		var punctuation = [" ", ",", ".", "?", "!", ";", ":", "-", "(", ")"];		//(probably a better way to do this with character ranges)
		
		//separate out the results into the two temp arrays
		for (var i = 0; i < results.length; i++) {
			
			var substring_index = results[i].definition.toLowerCase().indexOf(str.toLowerCase());
						
			//exact result first
			if ( results[i].definition.length == str.length ) { 	//if search string and definition are the same...
				temp_exact.push(i); 	//add the results index				}
			//left edge next...
			} else if ( substring_index == 0 	//check if searh string is at left edge...
						&& results[i].definition.length > str.length		//and if there's additional characters after...
						&& punctuation.includes( results[i].definition[str.length]) ) { 	//and the next character after the search term is in the punctuation array...
				temp_exact.push(i); 	//add the results index
			//right edge next...
			} else if ( substring_index > 0		//if substring exists and there's characters before it...
						&& results[i].definition.length == (substring_index + str.length)	//and search string is at right edge...
						&& punctuation.includes( results[i].definition[substring_index -1]) ) { //and the character before the search term is in the punctuation array...
				temp_exact.push(i); 	//add the results index
			//middle cases...
			} else if ( substring_index > 0		//if substring exists and there's characters before...
						&& results[i].definition.length > str.length		//and after...
						&& punctuation.includes(results[i].definition[substring_index -1])	//and the character before is in punctuation array...
						&& punctuation.includes(results[i].definition[substring_index + str.length]) ) {		//as well as the character after...
				temp_exact.push(i); 	//add the results index
			//otherwise (if there's characters next to the search string)...
			} else {
				temp_partial.push(i);		//add the results index to the other array
			}
		}
		
		//markup - remove ''' ... '''  and  ~~ ... ~~
		//replpace [[...]] with <a>..</a> HTML tags
		for (var i = 0; i < temp_exact.length; i++) {
			results[temp_exact[i]].definition =
				this.replaceMarkup(
					results[temp_exact[i]].definition
						.replaceAll("'''","")
						.replaceAll("~~",""));}
		for (var i = 0; i < temp_partial.length; i++) {
			results[temp_partial[i]].definition =
				this.replaceMarkup(
					results[temp_partial[i]].definition
						.replaceAll("'''","")
						.replaceAll("~~",""));}
		
		//highlight the search terms in the results
		for (var i = 0; i < temp_exact.length; i++)   results[temp_exact[i]].definition   = this.addHighlights(results[temp_exact[i]].definition, str);
		for (var i = 0; i < temp_partial.length; i++) results[temp_partial[i]].definition = this.addHighlights(results[temp_partial[i]].definition, str);
		
		//display results starting with total number of hits found...
		formatted_results = "<div><h2>" + results.length + " results found</h2></div>";
		
		//exact results first
		for (var j = 0; j < temp_exact.length; j++) {
			
			var i = temp_exact[j]; //get the current index from the above array

			formatted_results += 
				"<div class='results-english'>" +
					"<h3><a href='#' data-query=\"" + results[i].entry + "\">" + results[i].entry + "</a></h3>" +
					"<p><b>Part of Speech:</b> " + results[i].part_of_speech + "</p>" +
					"<p><b>Definition:</b> " + results[i].definition + "</p>" +
				"</div>";
		}
		
		//partial matches next
		for (var j = 0; j < temp_partial.length; j++) {
			
			var i = temp_partial[j]; //get the current index from the above array
			
			formatted_results += 
				"<div class='results-english'>" +
					"<h3><a href='#' data-query=\"" + results[i].entry + "\">" + results[i].entry + "</a></h3>" +
					"<p><b>Part of Speech:</b> " + results[i].part_of_speech + "</p>" +
					"<p><b>Definition:</b> " + results[i].definition + "</p>" +
				"</div>";
		}
		
		//insert into document
		this.results_div.innerHTML = "<div class='results-single'>" + formatted_results + "</div>";
	}
}


//
// Display Error (from PHP fetch)
//
diksionariu.prototype.displayError = function(err) {
	this.results_div.innerHTML = "<div class='no-result'>Not able to connect to database: </br>" + err + "</div>";
}